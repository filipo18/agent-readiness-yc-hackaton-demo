import {
  FixerEngine,
  type FindingInput,
  type FixerView,
  type RelayMessageInput,
} from "@readiness/shop"

export interface FixerOpenInput {
  storeUrl?: string
  findings?: FindingInput[]
  relayMessages?: RelayMessageInput[]
}

type Session = { mode: "local"; engine: FixerEngine; posted: number } | { mode: "actor"; posted: number }

const globalSessions = globalThis as unknown as { __fixerSessions?: Map<string, Session> }

function sessions(): Map<string, Session> {
  if (!globalSessions.__fixerSessions) globalSessions.__fixerSessions = new Map()
  return globalSessions.__fixerSessions
}

function requireSession(sessionId: string): Session {
  const session = sessions().get(sessionId)
  if (!session) throw new Error("That fixer session is gone. Open it again.")
  return session
}

interface FixerStub {
  open(input: FixerOpenInput & { sessionId: string }): Promise<FixerView>
  approve(id: string, approved: boolean): Promise<FixerView>
  apply(): Promise<FixerView>
  revert(): Promise<FixerView>
  rerun(): Promise<FixerView>
  current(): Promise<FixerView>
}

async function actorStub(sessionId: string): Promise<FixerStub> {
  const { createActorStub } = await import("./generated/terse-transport.js")
  return createActorStub<FixerStub>("Fixer", sessionId, [
    { name: "open", result: "value" },
    { name: "approve", result: "value" },
    { name: "apply", result: "value" },
    { name: "revert", result: "value" },
    { name: "rerun", result: "value" },
    { name: "current", result: "value" },
  ])
}

let relayPoster: Promise<{ post(text: string, key: string): Promise<void> } | null> | null = null

function poster(): Promise<{ post(text: string, key: string): Promise<void> } | null> {
  if (!process.env.RELAY_WORKSPACE_KEY?.trim()) return Promise.resolve(null)
  if (!relayPoster) {
    relayPoster = import("./relay.js")
      .then((mod) => mod.connectRelay(async () => undefined))
      .then((squad) => ({
        async post(text: string, key: string) {
          await squad.coordinator.sendMessage({ to: "#floor", text, idempotencyKey: key })
        },
      }))
      .catch((error: unknown) => {
        relayPoster = null
        console.error("fixer relay", error instanceof Error ? error.message : error)
        return null
      })
  }
  return relayPoster
}

/** Each applied or reverted change is one #floor line. Missing Relay keeps the line in the response. */
export async function postFloor(lines: { text: string; key: string }[]): Promise<void> {
  if (lines.length === 0 || !process.env.RELAY_WORKSPACE_KEY?.trim()) return
  const relay = await Promise.race([
    poster(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
  ])
  if (!relay) return
  for (const line of lines) {
    await relay.post(line.text, line.key).catch((error: unknown) => {
      console.error("fixer floor", error instanceof Error ? error.message : error)
    })
  }
}

async function deliver(sessionId: string, view: FixerView): Promise<FixerView> {
  const session = sessions().get(sessionId)
  const start = session?.posted ?? 0
  const fresh = view.floor.slice(start)
  if (session) session.posted = view.floor.length
  await postFloor(fresh.map((text, index) => ({ text, key: `${sessionId}:${start + index}` })))
  return view
}

export async function openFixer(input: FixerOpenInput = {}): Promise<FixerView> {
  const sessionId = crypto.randomUUID().slice(0, 8)
  if (process.env.FIXER_ACTOR === "on") {
    const stub = await actorStub(sessionId)
    const view = await stub.open({ ...input, sessionId })
    sessions().set(view.sessionId, { mode: "actor", posted: 0 })
    return deliver(view.sessionId, view)
  }
  const engine = await FixerEngine.open({ ...input, sessionId })
  const view = engine.view()
  sessions().set(view.sessionId, { mode: "local", engine, posted: 0 })
  return deliver(view.sessionId, view)
}

async function withSession(sessionId: string, local: (engine: FixerEngine) => Promise<FixerView> | FixerView, actor: (stub: FixerStub) => Promise<FixerView>): Promise<FixerView> {
  const session = requireSession(sessionId)
  const view = session.mode === "actor" ? await actor(await actorStub(sessionId)) : await local(session.engine)
  return deliver(sessionId, view)
}

export function getFixer(sessionId: string): Promise<FixerView> {
  return withSession(sessionId, (engine) => engine.view(), (stub) => stub.current())
}

export function approveFixer(sessionId: string, proposalId: string, approved: boolean): Promise<FixerView> {
  return withSession(
    sessionId,
    (engine) => engine.approve(proposalId, approved),
    (stub) => stub.approve(proposalId, approved),
  )
}

export function applyFixer(sessionId: string): Promise<FixerView> {
  return withSession(sessionId, (engine) => engine.apply(), (stub) => stub.apply())
}

export function revertFixer(sessionId: string): Promise<FixerView> {
  return withSession(sessionId, (engine) => engine.revert(), (stub) => stub.revert())
}

export function rerunFixer(sessionId: string): Promise<FixerView> {
  return withSession(sessionId, (engine) => engine.rerun(), (stub) => stub.rerun())
}

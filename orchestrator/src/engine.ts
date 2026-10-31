import {
  PERSONAS,
  PERSONA_IDS,
  ReportJournal,
  scoreMission,
  type PersonaId,
  type ReportView,
  type ShopperView,
} from "@readiness/protocol"
import { loadSnapshot, shopPersona, shopUrlFromEnv, storefrontPasswordFromEnv, type ShopAnnouncement } from "@readiness/shop"

export interface RelayNote {
  id: string
  channel: "floor" | "findings"
  from: string
  text: string
  at: string
}

export type RunEvent =
  | { type: "shopper"; view: ShopperView }
  | { type: "report"; report: ReportView }
  | { type: "relay"; message: RelayNote }
  | { type: "meta"; relay: "local" | "agent-relay"; storeUrl: string }
  | { type: "done" }
  | { type: "error"; message: string }

export interface RunRequest {
  mode: "fixture" | "live"
  fixture: "before" | "after"
  storeUrl?: string
  stepMs?: number
  /** `auto` mirrors to Agent Relay when RELAY_WORKSPACE_KEY is set. */
  relay?: "local" | "auto"
}

let noteSeq = 0

function note(channel: RelayNote["channel"], from: string, text: string): RelayNote {
  noteSeq += 1
  return {
    id: `m${noteSeq}`,
    channel,
    from,
    text,
    at: new Date().toISOString(),
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function idleView(persona: PersonaId): ShopperView {
  return {
    persona,
    status: "idle",
    goal: PERSONAS[persona].goal,
    step: "Waiting",
    stepsDone: 0,
    cartVariantId: null,
    missionScore: null,
    blockerCodes: [],
  }
}

export async function* runAudit(request: RunRequest): AsyncGenerator<RunEvent> {
  const stepMs = request.stepMs ?? 0
  const storeUrl = request.mode === "live" ? request.storeUrl || shopUrlFromEnv() : "https://aiconvertit-demo.myshopify.com"
  const mirror = request.relay === "auto" ? await connectMirror() : null
  yield { type: "meta", relay: mirror ? "agent-relay" : "local", storeUrl }

  let snapshot
  try {
    snapshot = await loadSnapshot({ mode: request.mode, fixture: request.fixture, storeUrl })
  } catch (error) {
    yield { type: "error", message: error instanceof Error ? error.message : "The store could not be read." }
    return
  }

  if (request.mode === "live" && snapshot.evidence.http.passwordWall && !storefrontPasswordFromEnv()) {
    yield {
      type: "error",
      message: "This dev store is password-gated. Set SHOP_STOREFRONT_PASSWORD and run again. The password is not in the repo.",
    }
    return
  }

  if (snapshot.evidence.http.passwordWall) {
    yield {
      type: "error",
      message: "The storefront password was rejected. Check SHOP_STOREFRONT_PASSWORD.",
    }
    return
  }

  const runId = crypto.randomUUID().slice(0, 8)
  const journal = new ReportJournal()
  const report = await journal.open(runId, snapshot.evidence)
  yield { type: "report", report }

  const viz = Math.round((snapshot.evidence.catalog.experimentRatio ?? 0) * snapshot.evidence.catalog.productCount)
  yield* say(
    note(
      "floor",
      "coordinator",
      `Opened ${snapshot.origin}. ${snapshot.products.length} products, ${viz} titles start with VIZ. One report writer.`,
    ),
    mirror,
    stepMs,
  )

  for (const persona of PERSONA_IDS) {
    yield { type: "shopper", view: { ...idleView(persona), status: "running", step: "Starting" } }
    const outcome = await shopPersona({
      persona,
      snapshot,
      liveCart: request.mode === "live",
      useModel: request.mode === "live" && Boolean(process.env.OPENAI_API_KEY?.trim()),
    })
    let stepsDone = 0
    for (const line of outcome.steps) {
      stepsDone += 1
      const view: ShopperView = {
        ...idleView(persona),
        status: "running",
        step: line,
        stepsDone,
        cartVariantId: outcome.cartVariantId,
        blockerCodes: outcome.blockerCodes,
      }
      yield { type: "shopper", view }
      yield* say(note("floor", persona, line), mirror, stepMs)
    }
    const submitted = await journal.submitMission(outcome.mission)
    const missionScore = submitted.missions.find((mission) => mission.persona === persona)?.score
      ?? scoreMission(persona, outcome.mission, snapshot.evidence).score
    yield {
      type: "shopper",
      view: {
        ...idleView(persona),
        status: outcome.mission.abandoned ? "blocked" : "done",
        step: outcome.steps.at(-1) ?? "Finished",
        stepsDone: outcome.steps.length,
        cartVariantId: outcome.cartVariantId,
        missionScore,
        blockerCodes: outcome.blockerCodes,
      },
    }
    yield { type: "report", report: submitted }
    for (const item of outcome.announcements) {
      yield* say(note("findings", persona, JSON.stringify(findingBody(runId, persona, item))), mirror, stepMs)
    }
  }

  const finalReport = await journal.finalize()
  yield { type: "report", report: finalReport }
  yield* say(
    note("floor", "coordinator", `Score ${finalReport.total}. The rubric assigned it. The model did not.`),
    mirror,
    stepMs,
  )
  yield { type: "done" }
}

function findingBody(runId: string, persona: PersonaId, item: ShopAnnouncement) {
  return { runId, persona, code: item.code, summary: item.summary }
}

async function* say(message: RelayNote, mirror: RelayMirror | null, stepMs: number): AsyncGenerator<RunEvent> {
  yield { type: "relay", message }
  if (mirror) await mirror.post(message).catch(() => undefined)
  await sleep(stepMs)
}

interface RelayMirror {
  post(message: RelayNote): Promise<void>
}

async function connectMirror(): Promise<RelayMirror | null> {
  if (!process.env.RELAY_WORKSPACE_KEY?.trim()) return null
  try {
    const connected = await Promise.race([
      import("./relay.ts").then((mod) => mod.connectRelay(async () => undefined)),
      sleep(8_000).then(() => {
        throw new Error("Relay timed out")
      }),
    ])
    return {
      async post(message: RelayNote) {
        const speaker =
          connected.shoppers.find((shopper) => shopper.name === message.from) ?? connected.coordinator
        await speaker.sendMessage({
          to: `#${message.channel}`,
          text: message.text,
          idempotencyKey: message.id,
        })
      },
    }
  } catch (error) {
    console.error("Agent Relay unavailable, keeping the local transcript.", error instanceof Error ? error.message : error)
    return null
  }
}

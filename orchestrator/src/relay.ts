import { AgentRelay, createObserverToken, type RelayAgentClient } from "@agent-relay/sdk"
import { PERSONA_IDS } from "@readiness/protocol"
import { z } from "zod"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"

// Agent tokens per workspace, so reruns reconnect instead of hitting name_conflict.
const AGENT_FILE = process.env.RELAY_AGENT_FILE ?? findRepoFile(".relay-agents.json")

/** Walk up from cwd to the workspace root (bundlers rewrite import.meta.url). */
function findRepoFile(name: string): string {
  const { existsSync } = require("node:fs") as typeof import("node:fs")
  const path = require("node:path") as typeof import("node:path")
  let dir = process.cwd()
  for (;;) {
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, ".env.relay"))) return path.join(dir, name)
    const up = path.dirname(dir)
    if (up === dir) return path.join(process.cwd(), name)
    dir = up
  }
}

function quiet<T>(p: Promise<T>): Promise<T | undefined> {
  return p.catch(() => undefined)
}

async function agentFor(relay: AgentRelay, workspaceKey: string, name: string, extra: Record<string, unknown>): Promise<RelayAgentClient> {
  const store: Record<string, Record<string, string>> = existsSync(AGENT_FILE) ? JSON.parse(readFileSync(AGENT_FILE, "utf8")) : {}
  const ws = workspaceKey.slice(-12)
  const saved = store[ws]?.[name]
  if (saved) {
    try {
      return await relay.workspace.reconnect({ apiToken: saved })
    } catch {
      // fall through and register
    }
  }
  // Sequential + backoff: Relaycast rate-limits bursts ("write capacity is busy").
  // If the name exists but we lost its token, take a suffixed name instead.
  let agent: RelayAgentClient | undefined
  let attempt = 0
  let suffix = 0
  while (!agent) {
    const tryName = suffix ? `${name}-${suffix}` : name
    try {
      agent = (await relay.workspace.register({ name: tryName, type: "agent", ...extra } as any)) as RelayAgentClient
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/already exists|name_conflict/i.test(msg) && suffix < 20) { suffix += 1; continue }
      if (/busy|retry|overloaded|429|503/i.test(msg) && attempt < 6) { attempt += 1; await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); continue }
      throw error
    }
  }
  if (agent.token) {
    store[ws] = { ...(store[ws] ?? {}), [name]: agent.token }
    writeFileSync(AGENT_FILE, JSON.stringify(store))
    chmodSync(AGENT_FILE, 0o600)
  }
  return agent
}

export const FindingReport = z.object({
  runId: z.string(),
  persona: z.enum(PERSONA_IDS),
  code: z.string(),
  summary: z.string(),
})

export type FindingReportInput = z.infer<typeof FindingReport>

export interface RelaySquad {
  relay: AgentRelay
  workspaceKey: string
  observerToken: string
  coordinator: RelayAgentClient
  shoppers: RelayAgentClient[]
  /** Logical name (persona or "coordinator") to client; registered name may carry a suffix. */
  byName: Record<string, RelayAgentClient>
}

/**
 * Workspace, channels, and the typed action the report actor consumes.
 * The handler must stay fast. It should call `StoreReport.submitMission`
 * once the generated Terse client exists. It must not call an LLM.
 *
 * `commands.invoke` lives on an agent-scoped messaging client, not on
 * `RelayAgentClient` (verified in `@agent-relay/sdk` 15.0.1). Shoppers post
 * to `#findings`; this process listens and performs the serialized write.
 * Also register the action so the schema and `action.completed` events exist.
 */
export async function connectRelay(onFinding: (input: FindingReportInput, from: string) => Promise<void>): Promise<RelaySquad> {
  const baseUrl = process.env.RELAY_BASE_URL || undefined
  const existing = process.env.RELAY_WORKSPACE_KEY
  const relay = existing
    ? new AgentRelay({ workspaceKey: existing, baseUrl })
    : await AgentRelay.createWorkspace({
        name: `agent-readiness-${Date.now().toString(36)}`,
        baseUrl,
      })

  const workspaceKey = relay.workspaceKey ?? existing
  if (!workspaceKey) {
    throw new Error("Relay created a workspace but did not expose workspaceKey. Set RELAY_WORKSPACE_KEY.")
  }

  const coordinator = await agentFor(relay, workspaceKey, "coordinator", {})
  const shoppers: RelayAgentClient[] = []
  const byName: Record<string, RelayAgentClient> = { coordinator }
  for (const persona of PERSONA_IDS) {
    const agent = await agentFor(relay, workspaceKey, persona, { persona })
    shoppers.push(agent)
    byName[persona] = agent
  }

  // Channels already exist on reruns; ignore "already exists".
  await quiet(coordinator.channels.create({ name: "floor", topic: "Shopper status, questions, and tips" }))
  await quiet(coordinator.channels.create({ name: "findings", topic: "Structured blockers. One message per finding code." }))
  for (const shopper of shoppers) {
    await quiet(shopper.channels.join("floor"))
    await quiet(shopper.channels.join("findings"))
  }

  const reported = relay.registerAction({
    name: "finding.report",
    description: "Record a store blocker observed by a shopper.",
    input: FindingReport,
    availableTo: [...PERSONA_IDS],
    handler: async ({ input, agent }) => {
      await onFinding(input, agent.name)
      return { accepted: true }
    },
  })

  relay.addListener("message.created", async (event) => {
    if (event.envelope.channel?.name !== "findings") return
    const parsed = FindingReport.safeParse(tryJson(event.message.text))
    if (!parsed.success) return
    await onFinding(parsed.data, event.envelope.from?.name ?? parsed.data.persona)
  })

  relay.addListener(reported.failed(), (event) => {
    console.error("finding.report failed", event.error)
  })

  // Reuse a saved observer token; otherwise mint one with a unique name.
  const savedObserver = process.env.RELAY_OBSERVER_TOKEN?.trim()
  const observer = savedObserver ? { token: savedObserver } : await createObserverToken({
    workspaceKey,
    name: `dashboard-${Date.now().toString(36)}`,
    baseUrl,
    filters: { channelNames: ["floor", "findings"] },
  })
  if (!observer.token) {
    throw new Error("Observer token was not returned. The dashboard cannot stream Relay without it.")
  }

  return { relay, workspaceKey, observerToken: observer.token, coordinator, shoppers, byName }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

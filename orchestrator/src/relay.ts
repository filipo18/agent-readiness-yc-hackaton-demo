import { AgentRelay, createObserverToken, type RelayAgentClient } from "@agent-relay/sdk"
import { PERSONA_IDS } from "@readiness/protocol"
import { z } from "zod"

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

  const coordinator = await relay.workspace.register({ name: "coordinator", type: "agent" })
  const shoppers: RelayAgentClient[] = []
  for (const persona of PERSONA_IDS) {
    shoppers.push(await relay.workspace.register({ name: persona, type: "agent", persona }))
  }

  await coordinator.channels.create({
    name: "floor",
    topic: "Shopper status, questions, and tips",
  })
  await coordinator.channels.create({
    name: "findings",
    topic: "Structured blockers. One message per finding code.",
  })
  for (const shopper of shoppers) {
    await shopper.channels.join("floor")
    await shopper.channels.join("findings")
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

  const observer = await createObserverToken({
    workspaceKey,
    name: "dashboard",
    baseUrl,
    filters: { channelNames: ["floor", "findings"] },
  })
  if (!observer.token) {
    throw new Error("Observer token was not returned. The dashboard cannot stream Relay without it.")
  }

  return { relay, workspaceKey, observerToken: observer.token, coordinator, shoppers }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

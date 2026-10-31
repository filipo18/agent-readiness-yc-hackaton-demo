import { AgentRelay } from "@agent-relay/sdk"
import { readFileSync } from "node:fs"
// Read recent #floor / #findings messages back from Relay. Prints no secrets.
const relay = new AgentRelay({ workspaceKey: process.env.RELAY_WORKSPACE_KEY!, baseUrl: process.env.RELAY_BASE_URL || undefined })
const tokens = JSON.parse(readFileSync(new URL("../../.relay-agents.json", import.meta.url).pathname, "utf8"))
const ws = Object.values(tokens).at(-1) as Record<string, string>
const agent = await relay.workspace.reconnect({ apiToken: ws.coordinator! })
for (const ch of ["floor", "findings"]) {
  const msgs = (await (agent.messages as any).list(ch, { limit: 100 })) as any[]
  console.log(`#${ch}: ${msgs.length} messages`)
  for (const m of msgs.slice(0, 4)) console.log("  ", m.from?.name ?? m.agentName ?? "?", "|", String(m.text).slice(0, 90))
}
process.exit(0)

import { runAudit } from "./engine.ts"

// Live squad against SHOP_URL. Never prints secrets.
let final: any
let meta: any
const floor: string[] = []
for await (const event of runAudit({ mode: "live", fixture: "before", stepMs: 0, relay: "auto" })) {
  if (event.type === "meta") meta = event
  if (event.type === "relay") floor.push(`#${event.message.channel} ${event.message.from}: ${event.message.text}`)
  if (event.type === "report" && event.report.status === "final") final = event.report
  if (event.type === "error") { console.error("ERROR", event.message); process.exit(1) }
}
console.log("relay:", meta?.relay, "store:", meta?.storeUrl)
console.log(floor.join("\n"))
console.log(JSON.stringify(final, null, 2))
process.exit(0)

import { runAudit, type RunEvent } from "./engine.ts"

async function play(fixture: "before" | "after"): Promise<{ total: number; gift: number | undefined; codes: string[] }> {
  let total = 0
  let gift: number | undefined
  let codes: string[] = []
  const events: RunEvent[] = []
  for await (const event of runAudit({ mode: "fixture", fixture, stepMs: 0, relay: "local" })) {
    events.push(event)
    if (event.type === "report" && event.report.status === "final") {
      total = event.report.total
      gift = event.report.missions.find((mission) => mission.persona === "gift")?.score
      codes = event.report.findings.map((finding) => finding.code)
    }
    if (event.type === "error") throw new Error(event.message)
  }
  const floor = events.filter((event) => event.type === "relay" && event.message.channel === "floor").length
  const findings = events.filter((event) => event.type === "relay" && event.message.channel === "findings").length
  if (floor < 5) throw new Error(`${fixture} run did not post #floor lines`)
  if (findings < 1) throw new Error(`${fixture} run did not post #findings`)
  return { total, gift, codes }
}

const before = await play("before")
const after = await play("after")

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error(JSON.stringify({ before, after }, null, 2))
    throw new Error(message)
  }
}

assert(after.total > before.total, "shipping copy should raise the score")
assert(before.codes.includes("SHIPPING_HIDDEN_UNTIL_CHECKOUT"), "before hides the shipping price")
assert(before.codes.includes("SHIPPING_ETA_MISSING"), "before hides the delivery window")
assert(before.codes.includes("EXPERIMENT_TITLES"), "VIZ titles should be called out")
assert(before.codes.includes("RETURNS_POLICY_MISSING"), "returns policy stays missing")
assert(!after.codes.includes("SHIPPING_HIDDEN_UNTIL_CHECKOUT"), "after discloses the shipping price")
assert(!after.codes.includes("SHIPPING_ETA_MISSING"), "after discloses the delivery window")
assert(after.codes.includes("EXPERIMENT_TITLES"), "VIZ titles stay until the catalog is cleaned")
assert(after.codes.includes("RETURNS_POLICY_MISSING"), "returns stay open")
assert((after.gift ?? 0) > (before.gift ?? 0), "gift mission should rise")

console.log(JSON.stringify({ before, after, delta: after.total - before.total }, null, 2))

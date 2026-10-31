import { readFileSync } from "node:fs"
import { scoreStore } from "./score.ts"
import type { StoreEvidence } from "./evidence.ts"

function load(name: string): StoreEvidence {
  const url = new URL(`../../../fixtures/${name}/evidence.json`, import.meta.url)
  return JSON.parse(readFileSync(url, "utf8")) as StoreEvidence
}

const before = scoreStore(load("before"))
const after = scoreStore(load("after"))

const beforeCodes = before.findings.map((finding) => finding.code)
const afterCodes = after.findings.map((finding) => finding.code)

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error("FAIL", message)
    console.error(JSON.stringify({ before, after }, null, 2))
    process.exit(1)
  }
}

assert(after.total > before.total, "fixing shipping copy should raise the store score")
assert(beforeCodes.includes("SHIPPING_HIDDEN_UNTIL_CHECKOUT"), "before run hides shipping price")
assert(beforeCodes.includes("SHIPPING_ETA_MISSING"), "before run hides delivery window")
assert(beforeCodes.includes("RETURNS_POLICY_MISSING"), "returns policy still missing")
assert(!afterCodes.includes("SHIPPING_HIDDEN_UNTIL_CHECKOUT"), "after run discloses shipping price")
assert(!afterCodes.includes("SHIPPING_ETA_MISSING"), "after run discloses delivery window")
assert(afterCodes.includes("RETURNS_POLICY_MISSING"), "returns finding stays until that fix")

const giftBefore = before.missions.find((mission) => mission.persona === "gift")
const giftAfter = after.missions.find((mission) => mission.persona === "gift")
assert(giftBefore != null && giftAfter != null && giftAfter.score > giftBefore.score, "gift mission score should rise")

console.log(
  JSON.stringify(
    {
      before: before.total,
      after: after.total,
      delta: after.total - before.total,
      gift: { before: giftBefore?.score, after: giftAfter?.score },
      cleared: beforeCodes.filter((code) => !afterCodes.includes(code)),
      stillOpen: afterCodes,
    },
    null,
    2,
  ),
)

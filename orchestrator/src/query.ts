import { PERSONA_IDS } from "@readiness/protocol"
import { actors } from "./generated/index.js"
import { shopperId } from "./actors.ts"

const runId = process.argv[2]
if (!runId) throw new Error("usage: bun src/query.ts <runId>")
for (const persona of PERSONA_IDS) {
  const s = await actors.Shopper.get(shopperId(runId, persona)).state()
  console.log(`Shopper/${shopperId(runId, persona)}: ${s.view.status} score=${s.view.missionScore} steps=${s.steps.length} cart=${s.view.cartVariantId} blockers=${s.view.blockerCodes.join(",")}`)
}
const report = await actors.StoreReport.get(runId).finalize()
console.log(`StoreReport/${runId}: ${report.status} total=${report.total} missions=${report.missions.length}`)

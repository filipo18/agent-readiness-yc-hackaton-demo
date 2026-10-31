import { connectRelay } from "./relay.ts"

const squad = await connectRelay(async (input, from) => {
  // Replace this log with the generated client:
  // await actors.StoreReport.get(input.runId).submitMission(...)
  console.log("finding", from, input.code, input.summary)
})

console.log("Relay workspace key (save it in .env as RELAY_WORKSPACE_KEY):")
console.log(squad.workspaceKey)
console.log("Observer token for the dashboard (save it as RELAY_OBSERVER_TOKEN):")
console.log(squad.observerToken)
console.log(`Agents: coordinator, ${squad.shoppers.map((shopper) => shopper.name).join(", ")}`)
console.log("Channels: #floor #findings")
console.log("Next: implement Shopper.shop, then point onFinding at StoreReport.")

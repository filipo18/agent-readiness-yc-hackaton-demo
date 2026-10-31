import { resetStore } from "../src/reset.ts"
const dry = process.argv.includes("--dry")
const result = await resetStore({ dryRun: dry })
console.log(`${result.dryRun ? "[dry run] " : ""}${result.actions.join("\n")}`)
console.log(result.dryRun ? "Nothing was written." : "Store reset to the demo baseline.")

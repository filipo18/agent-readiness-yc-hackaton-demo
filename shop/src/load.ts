import { auditStorefront, type StorefrontSnapshot } from "./shopify.ts"
import { shopUrlFromEnv, storefrontPasswordFromEnv } from "./env.ts"
import { fixtureSnapshot } from "./fixture.ts"

export async function loadSnapshot(input: {
  mode: "fixture" | "live"
  fixture: "before" | "after"
  storeUrl?: string
}): Promise<StorefrontSnapshot> {
  if (input.mode === "fixture") return fixtureSnapshot(input.fixture)
  const storeUrl = input.storeUrl || shopUrlFromEnv()
  return auditStorefront(storeUrl, storefrontPasswordFromEnv())
}

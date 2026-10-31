import { auditStorefront, normalizeStoreUrl, type StorefrontSnapshot } from "./shopify.js"
import { shopUrlFromEnv, storefrontPasswordFromEnv } from "./env.js"
import { fixtureSnapshot } from "./fixture.js"

export async function loadSnapshot(input: {
  mode: "fixture" | "live"
  fixture: "before" | "after"
  storeUrl?: string
  /** Overrides SHOP_STOREFRONT_PASSWORD. */
  password?: string
}): Promise<StorefrontSnapshot> {
  if (input.mode === "fixture") return fixtureSnapshot(input.fixture)
  const storeUrl = input.storeUrl || shopUrlFromEnv()
  return auditStorefront(storeUrl, input.password?.trim() || envPasswordFor(storeUrl))
}

/** The env password belongs to the configured store only; never send it to another origin. */
export function envPasswordFor(storeUrl: string): string | undefined {
  try {
    return normalizeStoreUrl(storeUrl) === normalizeStoreUrl(shopUrlFromEnv()) ? storefrontPasswordFromEnv() : undefined
  } catch {
    return undefined
  }
}

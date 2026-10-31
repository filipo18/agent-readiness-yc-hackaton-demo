import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { LivePort, adminGraphqlFromEnv, adminShopHost, shouldDryRun, type AppliedOp, type StoreRead } from "./admin.js"

export interface ResetResult {
  dryRun: boolean
  baselineCreated: boolean
  baselinePath: string
  products: number
  actions: string[]
}

/** Repo root, whether called from the repo or from dashboard/. */
export function baselinePath(cwd: string = process.cwd()): string {
  const root = /[\\/](dashboard|actors|shop|orchestrator)$/.test(cwd) ? resolve(cwd, "..") : cwd
  return resolve(root, ".demo-baseline.json")
}

/**
 * Put the demo store back to the snapshot taken on first use. Works across
 * sessions: the snapshot lives on disk, not in a fixer session. Policies are
 * always written blank, which is the pre-demo state.
 */
export async function resetStore(opts: { env?: Record<string, string | undefined>; path?: string; dryRun?: boolean } = {}): Promise<ResetResult> {
  const env = opts.env ?? process.env
  const path = opts.path ?? baselinePath()
  const storeUrl = (env.SHOP_URL || "https://aiconvertit-demo.myshopify.com").replace(/\/$/, "")
  const shop = adminShopHost(storeUrl)
  const noCreds = shouldDryRun(env)
  const dryRun = opts.dryRun === true || noCreds
  const actions: string[] = []
  if (noCreds) {
    return { dryRun: true, baselineCreated: false, baselinePath: path, products: 0, actions: ["No Shopify credentials. Nothing to reset."] }
  }
  const port = new LivePort(adminGraphqlFromEnv(shop, env), shop)
  let baseline: StoreRead
  let baselineCreated = false
  if (existsSync(path)) {
    baseline = JSON.parse(readFileSync(path, "utf8")) as StoreRead
  } else {
    baseline = await port.read()
    baseline = { ...baseline, shippingHtml: "", shippingText: "", refundHtml: "", refundText: "" }
    if (baseline.products.length > 0 && !dryRun) {
      writeFileSync(path, JSON.stringify(baseline, null, 2), { mode: 0o600 })
      baselineCreated = true
      actions.push(`Saved baseline snapshot of ${baseline.products.length} products.`)
    } else if (baseline.products.length === 0) {
      actions.push("Admin read returned no Ghost or VIZ products; no product snapshot saved, policies only.")
    }
  }
  const ops: AppliedOp[] = [{ kind: "shipping" }, { kind: "refund" }]
  for (const product of baseline.products) {
    ops.push({ kind: "sizes", productId: product.id }, { kind: "viz", productId: product.id }, { kind: "jsonld", productId: product.id })
  }
  actions.push(`Restore ${baseline.products.length} products (titles, status, variants, metafield).`, "Blank the shipping and refund policies.")
  if (!dryRun) await port.restore({ ...baseline, shippingHtml: "", refundHtml: "" }, ops)
  return { dryRun, baselineCreated, baselinePath: path, products: baseline.products.length, actions }
}

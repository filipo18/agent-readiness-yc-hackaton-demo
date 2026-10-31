import { ADMIN_OPERATIONS, ADMIN_SCOPES, LivePort, adminAccessToken, clearAdminTokenCache, productSetVariables, revertDrift, seedDefects, shouldDryRun } from "./admin.js"
import { FixerEngine, collectFindings } from "./fixer.js"
import { FALLBACK_REFUND, FALLBACK_SHIPPING, draftPolicy, policyValid } from "./policy-draft.js"
import { ghostOf } from "./admin.js"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const scopes = ["write_products", "write_legal_policies"]
assert(ADMIN_SCOPES.join() === scopes.join(), "scope list drifted")
assert(shouldDryRun({} as Record<string, string | undefined>), "missing credentials should dry-run")
assert(shouldDryRun({ SHOPIFY_CLIENT_ID: "id" } as Record<string, string | undefined>), "client id alone should dry-run")
assert(!shouldDryRun({ SHOPIFY_CLIENT_ID: "id", SHOPIFY_CLIENT_SECRET: "secret" } as Record<string, string | undefined>), "client credentials are the live path")
assert(policyValid("shipping", FALLBACK_SHIPPING), "fallback shipping misses the rubric")
assert(policyValid("refund", FALLBACK_REFUND), "fallback refund misses the rubric")

const ignored = collectFindings({
  findings: [{ code: "SHIPPING_ETA_MISSING", summary: "No delivery window" }],
  relayMessages: [
    { channel: "floor", text: "gift: hello" },
    { channel: "findings", text: JSON.stringify({ code: "RETURNS_POLICY_MISSING", summary: "No refund policy" }) },
    { channel: "findings", text: "not json" },
  ],
})
assert(ignored.map((item) => item.code).join() === "SHIPPING_ETA_MISSING,RETURNS_POLICY_MISSING", "finding merge failed")

const badFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "We ship things." }) } }] }), { status: 200 })
const fellBack = await draftPolicy("shipping", "We ship worldwide.", { fetch: badFetch, env: { OPENAI_API_KEY: "sk-test" } as Record<string, string | undefined> })
assert(fellBack.source === "fallback" && fellBack.text === FALLBACK_SHIPPING, "invalid model copy should fall back")
const goodFetch = async () =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "Flat rate $8. Arrives in 2-4 business days." }) } }] }), { status: 200 })
const drafted = await draftPolicy("shipping", null, { fetch: goodFetch, env: { OPENAI_API_KEY: "sk-test" } as Record<string, string | undefined> })
assert(drafted.source === "openai" && drafted.text.includes("$8"), "valid model copy should be kept")

const dry = await FixerEngine.open({ storeUrl: "https://aiconvertit-demo.myshopify.com" })
const opened = dry.view()
assert(opened.dryRun && !opened.writesToShopify, "no token means dry run")
assert(opened.steps[0]?.label === "Reading the listed $152 price.", opened.steps[0]?.label ?? "missing step")
assert(opened.proposals.map((item) => item.id).join() === "offer,shipping,refund,size,jsonld,viz", opened.proposals.map((item) => item.id).join())
assert(opened.scoreBefore > 0, "baseline score missing")
const applied = (await dry.apply()).scoreAfter
assert(applied != null && applied > opened.scoreBefore, `score did not rise (${opened.scoreBefore} → ${applied})`)
const after = dry.view()
assert(after.findings.some((finding) => finding.code === "NO_PRODUCT_JSONLD"), "JSON-LD hint must not pretend the HTML changed")
assert(!after.findings.some((finding) => finding.code === "SHIPPING_ETA_MISSING"), "shipping finding should clear")
assert(!after.findings.some((finding) => finding.code === "RETURNS_POLICY_MISSING"), "refund finding should clear")
assert(!after.findings.some((finding) => finding.code === "SIZE_OPTION_MISSING"), "size finding should clear")
assert(!after.findings.some((finding) => finding.code === "EXPERIMENT_TITLES"), "VIZ finding should clear")
assert(after.canRevert, "revert should be available after a write")
const reverted = await dry.revert()
assert(!reverted.canRevert && reverted.phase === "reverted", "revert did not clear the write log")
assert(reverted.scoreAfter == null, "reverted session should drop the after score")
assert(reverted.proposals.every((item) => item.status === "proposed" || !item.writes), "proposals should be selectable again")
const again = await dry.apply()
assert(again.scoreAfter != null && again.scoreAfter > opened.scoreBefore, "second rehearsal did not raise the score")
const restored = await dry.revert()
assert(restored.phase === "reverted" && !restored.canRevert, "second revert failed")

const selective = await FixerEngine.open({ storeUrl: "https://aiconvertit-demo.myshopify.com" })
selective.approve("shipping", false)
const partial = await selective.apply()
assert(partial.proposals.find((item) => item.id === "shipping")?.status === "skipped", "unchecked shipping should not write")
assert(partial.proposals.find((item) => item.id === "refund")?.status === "applied", "refund should still write")
assert(partial.findings.some((finding) => finding.code === "SHIPPING_ETA_MISSING"), "skipped shipping should stay a finding")
await selective.revert()

function readPayload(): StoreReadShape {
  return {
    shop: {
      shopPolicies: [{ id: "gid://shopify/ShopPolicy/1", type: "SHIPPING_POLICY", body: "<p>We ship worldwide.</p>", url: "https://aiconvertit-demo.myshopify.com/policies/shipping-policy" }],
    },
    ghost: {
      nodes: [
        {
          id: "gid://shopify/Product/18",
          title: "Brooks Men's Ghost 18 Running Shoes",
          handle: "brooks-mens-ghost-18-running-shoes",
          status: "ACTIVE",
          productType: "Running shoes",
          tags: ["brooks"],
          options: [{ id: "gid://shopify/ProductOption/1", name: "Title", values: ["Default Title"], optionValues: [{ name: "Default Title" }] }],
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/1800",
                title: "Default Title",
                price: "152.00",
                sku: "GHOST18",
                selectedOptions: [{ name: "Title", value: "Default Title" }],
              },
            ],
          },
          metafield: null,
        },
      ],
    },
    viz: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{ id: "gid://shopify/Product/1001", title: "VIZ V1", handle: "viz-v1", status: "ACTIVE" }],
    },
  }
}

interface StoreReadShape {
  shop: { shopPolicies: { id: string; type: string; body: string; url: string }[] }
  ghost: { nodes: unknown[] }
  viz: { pageInfo: { hasNextPage: boolean; endCursor: null }; nodes: unknown[] }
}

function script(log: { name: string; variables: Record<string, unknown> | undefined }[], failFirstSet: boolean) {
  let sets = 0
  return async (query: string, variables?: Record<string, unknown>) => {
    const name =
      ["shopPolicyUpdate", "productOptionsCreate", "productOptionUpdate", "productVariantsBulkUpdate", "productUpdate", "metafieldsSet", "metafieldsDelete", "productSet"].find((op) => query.includes(`mutation ${op}`)) ??
      (query.includes("FixerRead") ? "read" : "unknown")
    log.push({ name, variables })
    if (name === "read") return readPayload()
    if (name === "productSet") {
      sets += 1
      if (failFirstSet && sets === 1) return { productSet: { product: null, userErrors: [{ message: "Product variant does not exist" }] } }
      return { productSet: { product: { id: "gid://shopify/Product/18", hasOnlyDefaultVariant: true }, userErrors: [] } }
    }
    if (name === "productOptionsCreate") {
      return {
        productOptionsCreate: {
          userErrors: [],
          product: { id: "gid://shopify/Product/18", options: [], variants: { nodes: [{ id: "gid://shopify/ProductVariant/1800", title: "8", price: "0.00" }] } },
        },
      }
    }
    if (name === "unknown") throw new Error(query.slice(0, 80))
    return { [name]: { userErrors: [], shopPolicy: { id: "1" }, product: { id: "1", title: "x", status: "DRAFT" }, metafields: [], productVariants: [], deletedMetafields: [] } }
  }
}

const calls: { name: string; variables: Record<string, unknown> | undefined }[] = []
const live = await FixerEngine.open({
  storeUrl: "https://aiconvertit-demo.myshopify.com",
  port: new LivePort(script(calls, false), "aiconvertit-demo.myshopify.com"),
})
assert(!live.view().dryRun && live.view().writesToShopify, "injected live port should write")
await live.apply()
const names = calls.map((call) => call.name)
assert(names.includes("shopPolicyUpdate"), "missing shopPolicyUpdate")
assert(names.includes("productOptionsCreate"), "missing productOptionsCreate")
assert(names.includes("productVariantsBulkUpdate"), "new sizes should keep the listed price")
assert(names.includes("productUpdate"), "missing productUpdate for VIZ")
assert(names.includes("metafieldsSet"), "missing metafieldsSet")
const shippingWrite = calls.find((call) => call.name === "shopPolicyUpdate" && (call.variables?.shopPolicy as { type?: string } | undefined)?.type === "SHIPPING_POLICY")
assert(typeof (shippingWrite?.variables?.shopPolicy as { body?: string } | undefined)?.body === "string", "shipping body missing")
assert(((shippingWrite?.variables?.shopPolicy as { body: string }).body).includes("$6"), "shipping write should include the price")
const sizeWrite = calls.find((call) => call.name === "productOptionsCreate")
assert((sizeWrite?.variables?.variantStrategy as string) === "CREATE", "size option should create variants")
await live.revert()
const revertCalls = calls.slice(names.length)
const policyReverts = revertCalls.filter((call) => call.name === "shopPolicyUpdate")
const shippingRevert = policyReverts.find((call) => (call.variables?.shopPolicy as { type?: string }).type === "SHIPPING_POLICY")
assert((shippingRevert?.variables?.shopPolicy as { body?: string }).body === "<p>We ship worldwide.</p>", "revert must send the snapshotted shipping HTML")
const refundRevert = policyReverts.find((call) => (call.variables?.shopPolicy as { type?: string }).type === "REFUND_POLICY")
assert((refundRevert?.variables?.shopPolicy as { body?: string }).body === "", "missing refund policy reverts to an empty body")
const set = revertCalls.find((call) => call.name === "productSet")
assert(set != null, "size revert should use productSet")
const identifier = set?.variables?.identifier as { id?: string }
const input = set?.variables?.input as { id?: string; variants?: { id?: string; price?: string; optionValues?: { optionName: string; name: string }[] }[]; productOptions?: { name: string }[] }
assert(identifier?.id === "gid://shopify/Product/18", "productSet should identify the product")
assert(input?.id == null, "productSet input.id is deprecated; use identifier")
assert(set?.variables?.synchronous === true, "productSet should be synchronous")
assert(input?.variants?.[0]?.id === "gid://shopify/ProductVariant/1800", "revert should keep the original variant id")
assert(input?.variants?.[0]?.price === "152.00", "revert should restore the price")
assert(input?.variants?.[0]?.optionValues?.[0]?.optionName === "Title", "revert should restore the Title option")
const vizRevert = revertCalls.find((call) => call.name === "productUpdate")
assert((vizRevert?.variables?.product as { title?: string; status?: string }).title === "VIZ V1", "VIZ title was not restored")
assert((vizRevert?.variables?.product as { status?: string }).status === "ACTIVE", "VIZ status was not restored")
assert(revertCalls.some((call) => call.name === "metafieldsDelete"), "JSON-LD hint should be deleted on revert")
assert(live.view().phase === "reverted", "live revert should confirm against the re-read")

const fallbackLog: { name: string; variables: Record<string, unknown> | undefined }[] = []
const seeded = seedDefects("aiconvertit-demo.myshopify.com")
const ghost = ghostOf(seeded)
assert(ghost != null, "seed ghost missing")
const fallbackPort = new LivePort(script(fallbackLog, true), "aiconvertit-demo.myshopify.com")
await fallbackPort.restoreProduct(ghost)
const sets = fallbackLog.filter((call) => call.name === "productSet")
assert(sets.length === 2, "a missing variant id should retry productSet without ids")
assert((sets[1]?.variables?.input as { variants?: { id?: string }[] }).variants?.[0]?.id == null, "retry should omit variant ids")

const sample = productSetVariables(ghost, true)
assert(ADMIN_OPERATIONS.productSet.includes("productSet"), "productSet document missing")
assert(ADMIN_OPERATIONS.shopPolicyUpdate.includes("shopPolicyUpdate"), "shopPolicyUpdate document missing")
assert((sample.input as { variants: unknown[] }).variants.length === 1, "seed ghost should restore one variant")

const drifted = revertDrift(seeded, { ...seeded, shippingHtml: "<p>Flat rate $6.</p>", shippingText: "Flat rate $6." }, [{ kind: "shipping" }])
assert(drifted.includes("shipping policy"), "drift check should notice a policy that did not revert")

clearAdminTokenCache()
let tokenFetches = 0
let shortToken = false
const tokenEnv = { SHOPIFY_CLIENT_ID: "app-id", SHOPIFY_CLIENT_SECRET: "app-secret" } as Record<string, string | undefined>
const tokenFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
  tokenFetches += 1
  const body = String(init?.body ?? "")
  assert(String(url) === "https://aiconvertit-demo.myshopify.com/admin/oauth/access_token", "token URL")
  assert(body.includes("grant_type=client_credentials"), "grant type")
  assert(body.includes("client_id=app-id") && body.includes("client_secret=app-secret"), "client credentials form")
  assert(!body.includes("shpat_"), "no static admin token")
  return Response.json({
    access_token: `tok-${tokenFetches}`,
    expires_in: shortToken ? 30 : 86_399,
    scope: "write_products,write_legal_policies",
  })
}
const first = await adminAccessToken("aiconvertit-demo.myshopify.com", { env: tokenEnv, fetch: tokenFetch })
const second = await adminAccessToken("aiconvertit-demo.myshopify.com", { env: tokenEnv, fetch: tokenFetch })
assert(first === second && tokenFetches === 1, "token should be cached until near expiry")
clearAdminTokenCache()
tokenFetches = 0
shortToken = true
await adminAccessToken("aiconvertit-demo.myshopify.com", { env: tokenEnv, fetch: tokenFetch })
const refreshed = await adminAccessToken("aiconvertit-demo.myshopify.com", { env: tokenEnv, fetch: tokenFetch })
assert(tokenFetches === 2 && refreshed === "tok-2", "a token inside the refresh window should be minted again")

console.log(`fixer check ok · dry-run score ${opened.scoreBefore} → ${applied}`)

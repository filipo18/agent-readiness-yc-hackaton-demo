import { isExperimentTitle, isGhost18 } from "./catalog.js"
import { stripHtml, type ShopifyProduct } from "./shopify.js"

/** Admin GraphQL version these documents are written against. */
export const ADMIN_API_VERSION = "2025-10"

/**
 * Scopes returned by the Dev Dashboard client-credentials grant on this app.
 * Shopify write scopes include the matching reads, so the products query and
 * `shopPolicies` read succeed with these two. Unpublish is `productUpdate`
 * status DRAFT (`write_products`), not `write_publications`. The JSON-LD hint
 * is a product metafield (`write_products`), not `write_themes`.
 */
export const ADMIN_SCOPES = ["write_products", "write_legal_policies"] as const

export const JSONLD_NAMESPACE = "agent_readiness"
export const JSONLD_KEY = "jsonld"

export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED"
export type PolicyType = "SHIPPING_POLICY" | "REFUND_POLICY"

export interface CatalogVariant {
  id: string
  numericId: number
  title: string
  price: string
  sku: string | null
  selectedOptions: { name: string; value: string }[]
}

export interface CatalogOption {
  id: string
  name: string
  values: string[]
}

export interface CatalogProduct {
  id: string
  numericId: number
  title: string
  handle: string
  status: ProductStatus
  productType: string
  tags: string
  options: CatalogOption[]
  variants: CatalogVariant[]
  jsonLd: string | null
  image: string | null
}

/** Exact values read before any write. Revert sends these back. */
export interface StoreRead {
  shop: string
  shippingHtml: string | null
  shippingText: string | null
  refundHtml: string | null
  refundText: string | null
  products: CatalogProduct[]
}

export type AppliedOp =
  | { kind: "shipping" }
  | { kind: "refund" }
  | { kind: "sizes"; productId: string }
  | { kind: "viz"; productId: string }
  | { kind: "jsonld"; productId: string }

export type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>

export const SIZES = ["8", "9", "10", "11", "12"] as const

export function adminShopHost(storeUrl: string): string {
  const raw = storeUrl.trim()
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  return url.hostname.toLowerCase()
}

export function shouldDryRun(env: Record<string, string | undefined> = (globalThis as any).process.env): boolean {
  return !env.SHOPIFY_CLIENT_ID?.trim() || !env.SHOPIFY_CLIENT_SECRET?.trim()
}

interface CachedToken {
  token: string
  /** Epoch ms when Shopify says the token expires. */
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()
const tokenInflight = new Map<string, Promise<string>>()
const REFRESH_EARLY_MS = 120_000

export function clearAdminTokenCache(): void {
  tokenCache.clear()
  tokenInflight.clear()
}

export type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface TokenDeps {
  env?: Record<string, string | undefined>
  fetch?: AdminFetch
}

/**
 * Client-credentials grant. Cached per shop and refreshed REFRESH_EARLY_MS
 * before `expires_in`. The secret and the access token are never logged.
 */
export async function adminAccessToken(shop: string, deps: TokenDeps = {}): Promise<string> {
  const hit = tokenCache.get(shop)
  if (hit && hit.expiresAt - REFRESH_EARLY_MS > Date.now()) return hit.token
  const pending = tokenInflight.get(shop)
  if (pending) return pending
  const request = mintAdminToken(shop, deps).finally(() => tokenInflight.delete(shop))
  tokenInflight.set(shop, request)
  return request
}

async function mintAdminToken(shop: string, deps: TokenDeps): Promise<string> {
  const env = deps.env ?? (globalThis as any).process.env
  const clientId = env.SHOPIFY_CLIENT_ID?.trim()
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) throw new Error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are not set")
  const fetchImpl = deps.fetch ?? fetch
  const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!response.ok || !payload.access_token) {
    const reason = payload.error_description || payload.error
    throw new Error(reason ? `Shopify token request failed: ${reason}` : `Shopify token HTTP ${response.status}`)
  }
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 86_399
  tokenCache.set(shop, { token: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 })
  return payload.access_token
}

function dropAdminToken(shop: string): void {
  tokenCache.delete(shop)
}

/** Builds the Admin client. Each call uses the cached client-credentials token. */
export function adminGraphqlFromEnv(shop: string, env: Record<string, string | undefined> = (globalThis as any).process.env): AdminGraphql {
  return async (query, variables) => {
    const send = async (token: string) => {
      const response = await fetch(`https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-access-token": token,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      })
      if (response.status === 401) {
        dropAdminToken(shop)
        await response.body?.cancel()
        throw new Error("Shopify Admin HTTP 401")
      }
      const payload = (await response.json()) as { data?: unknown; errors?: { message: string }[] }
      if (!response.ok || payload.errors?.length) {
        const message = payload.errors?.map((error) => error.message).join("; ")
        throw new Error(message || `Shopify Admin HTTP ${response.status}`)
      }
      return payload.data
    }
    try {
      return await send(await adminAccessToken(shop, { env }))
    } catch (error) {
      if (!(error instanceof Error) || !/HTTP 401/.test(error.message)) throw error
      return send(await adminAccessToken(shop, { env }))
    }
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function policyHtml(text: string): string {
  return `<p>${escapeHtml(text)}</p>`
}

export function cloneRead(read: StoreRead): StoreRead {
  return JSON.parse(JSON.stringify(read)) as StoreRead
}

export function ghostOf(read: StoreRead): CatalogProduct | null {
  const ghosts = read.products.filter((product) => isGhost18(asShopify(product)))
  const active = ghosts.filter((product) => product.status === "ACTIVE")
  const pool = active.length > 0 ? active : ghosts
  return (
    pool
      .slice()
      .sort((a, b) => Number(a.variants[0]?.price ?? Infinity) - Number(b.variants[0]?.price ?? Infinity))[0] ?? null
  )
}

export function vizProducts(read: StoreRead): CatalogProduct[] {
  return read.products.filter((product) => isExperimentTitle(product.title))
}

export function hasSize(product: CatalogProduct, size: string): boolean {
  const wanted = size.toLowerCase()
  return product.options.some(
    (option) =>
      option.name.toLowerCase() === "size" && option.values.some((value) => value.toLowerCase() === wanted),
  )
}

export function asShopify(product: CatalogProduct): ShopifyProduct {
  return {
    id: product.numericId,
    title: product.title,
    handle: product.handle,
    body_html: "",
    product_type: product.productType,
    tags: product.tags,
    options: product.options.map((option) => ({ name: option.name, values: option.values })),
    variants: product.variants.map((variant) => ({
      id: variant.numericId,
      title: variant.title,
      option1: variant.selectedOptions[0]?.value ?? null,
      option2: variant.selectedOptions[1]?.value ?? null,
      option3: variant.selectedOptions[2]?.value ?? null,
      price: variant.price,
      available: product.status === "ACTIVE",
      sku: variant.sku,
    })),
    images: product.image ? [{ src: product.image }] : [],
  }
}

export function draftVizTitle(title: string): string {
  const match = title.match(/(\d+)\s*$/)
  const suffix = match?.[1] ?? title.replace(/^VIZ\b/i, "").trim()
  return `Draft experiment ${suffix}`.trim()
}

/** Local catalog transitions. Live writes go through `LivePort`; this updates the in-memory read. */
export function applyShippingLocal(state: StoreRead, html: string, text: string): void {
  state.shippingHtml = html
  state.shippingText = text
}

export function applyRefundLocal(state: StoreRead, html: string, text: string): void {
  state.refundHtml = html
  state.refundText = text
}

export function applySizesLocal(state: StoreRead, productId: string, sizes: readonly string[]): void {
  const product = state.products.find((item) => item.id === productId)
  if (!product) return
  const price = product.variants[0]?.price ?? "0.00"
  const sku = product.variants[0]?.sku ?? "GHOST18"
  const others = product.options.filter((option) => option.name.toLowerCase() !== "title" && option.name.toLowerCase() !== "size")
  if (others.length > 0) {
    const sizeOption = product.options.find((option) => option.name.toLowerCase() === "size")
    const values = [...new Set([...(sizeOption?.values ?? []), ...sizes])]
    product.options = [
      ...others,
      { id: sizeOption?.id ?? `${product.id}-size`, name: "Size", values },
    ]
    const missing = values.filter((size) => !product.variants.some((variant) => variant.selectedOptions.some((option) => option.name.toLowerCase() === "size" && option.value === size)))
    const base = product.variants[0]
    product.variants = [
      ...product.variants,
      ...missing.map((size, index) => ({
        id: `${product.id}-size-${size}`,
        numericId: product.numericId * 100 + index + 1,
        title: size,
        price: base?.price ?? price,
        sku: `${sku}-${size}`,
        selectedOptions: [
          ...(base?.selectedOptions.filter((option) => option.name.toLowerCase() !== "size" && option.name.toLowerCase() !== "title") ?? []),
          { name: "Size", value: size },
        ],
      })),
    ]
    return
  }
  product.options = [{ id: `${product.id}-size`, name: "Size", values: [...sizes] }]
  product.variants = sizes.map((size, index) => ({
    id: `${product.id}-size-${size}`,
    numericId: product.numericId * 100 + index + 1,
    title: size,
    price,
    sku: `${sku}-${size}`,
    selectedOptions: [{ name: "Size", value: size }],
  }))
}

export function applyVizLocal(state: StoreRead, productId: string, title: string): void {
  const product = state.products.find((item) => item.id === productId)
  if (!product) return
  product.title = title
  product.status = "DRAFT"
}

export function applyJsonLdLocal(state: StoreRead, productId: string, json: string): void {
  const product = state.products.find((item) => item.id === productId)
  if (!product) return
  product.jsonLd = json
}

export function productJsonLd(product: { title: string; price: string }): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    brand: { "@type": "Brand", name: "Brooks" },
    category: "Neutral road running",
    model: "Ghost 18",
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: product.price,
      availability: "https://schema.org/InStock",
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "gender", value: "Male" },
      { "@type": "PropertyValue", name: "heelToToeDrop", value: "10 mm" },
    ],
  })
}

export function attributePairs(product: { title: string; price: string }): { key: string; value: string }[] {
  return [
    { key: "brand", value: "Brooks" },
    { key: "model", value: "Ghost 18" },
    { key: "gender", value: "Male" },
    { key: "category", value: "Neutral road running" },
    { key: "price", value: product.price },
    { key: "priceCurrency", value: "USD" },
    { key: "heelToToeDrop", value: "10 mm" },
  ]
}

const READ_QUERY = `# graphql
query FixerRead($ghostQuery: String!, $vizQuery: String!, $cursor: String) {
  shop {
    shopPolicies { id type body url }
  }
  ghost: products(first: 10, query: $ghostQuery) {
    nodes {
      id
      title
      handle
      status
      productType
      tags
      featuredMedia { preview { image { url } } }
      options { id name values optionValues { name } }
      variants(first: 100) {
        nodes { id title price sku selectedOptions { name value } }
      }
      metafield(namespace: "${JSONLD_NAMESPACE}", key: "${JSONLD_KEY}") { value }
    }
  }
  viz: products(first: 50, query: $vizQuery, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle status }
  }
}`

const POLICY_MUTATION = `# graphql
mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
  shopPolicyUpdate(shopPolicy: $shopPolicy) {
    shopPolicy { id body type }
    userErrors { field message }
  }
}`

const PRODUCT_UPDATE = `# graphql
mutation productUpdate($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id title status }
    userErrors { field message }
  }
}`

const OPTIONS_CREATE = `# graphql
mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
  productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
    userErrors { field message code }
    product {
      id
      options { id name values }
      variants(first: 30) { nodes { id title price selectedOptions { name value } } }
    }
  }
}`

const OPTION_UPDATE = `# graphql
mutation productOptionUpdate($productId: ID!, $option: OptionUpdateInput!, $optionValuesToAdd: [OptionValueCreateInput!], $variantStrategy: ProductOptionUpdateVariantStrategy) {
  productOptionUpdate(productId: $productId, option: $option, optionValuesToAdd: $optionValuesToAdd, variantStrategy: $variantStrategy) {
    userErrors { field message }
    product { id options { id name values } }
  }
}`

const VARIANTS_UPDATE = `# graphql
mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price }
    userErrors { field message }
  }
}`

const PRODUCT_SET = `# graphql
mutation productSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!, $synchronous: Boolean!) {
  productSet(identifier: $identifier, input: $input, synchronous: $synchronous) {
    product { id hasOnlyDefaultVariant }
    userErrors { field message code }
  }
}`

const METAFIELDS_SET = `# graphql
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key }
    userErrors { field message }
  }
}`

const METAFIELDS_DELETE = `# graphql
mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields { ownerId namespace key }
    userErrors { field message }
  }
}`

export const ADMIN_OPERATIONS = {
  read: READ_QUERY,
  shopPolicyUpdate: POLICY_MUTATION,
  productUpdate: PRODUCT_UPDATE,
  productOptionsCreate: OPTIONS_CREATE,
  productOptionUpdate: OPTION_UPDATE,
  productVariantsBulkUpdate: VARIANTS_UPDATE,
  productSet: PRODUCT_SET,
  metafieldsSet: METAFIELDS_SET,
  metafieldsDelete: METAFIELDS_DELETE,
} as const

interface UserError {
  message?: string
}

function assertOk(payload: unknown, key: string, label: string): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new Error(`${label} returned no data`)
  const node = (payload as Record<string, unknown>)[key]
  if (!node || typeof node !== "object") throw new Error(`${label} returned no ${key}`)
  const errors = (node as { userErrors?: UserError[] }).userErrors ?? []
  const messages = errors.map((error) => error.message).filter((message): message is string => Boolean(message))
  if (messages.length > 0) throw new Error(`${label}: ${messages.join("; ")}`)
  return node as Record<string, unknown>
}

function gidNumber(id: string): number {
  const value = Number(id.split("/").pop())
  return Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionValues(option: Record<string, unknown>): string[] {
  const fromValues = asArray(option.values).filter((value): value is string => typeof value === "string")
  if (fromValues.length > 0) return fromValues
  return asArray(option.optionValues)
    .map((value) => asRecord(value)?.name)
    .filter((value): value is string => typeof value === "string")
}

function parseProduct(node: unknown, partial = false): CatalogProduct | null {
  const record = asRecord(node)
  if (!record || typeof record.id !== "string" || typeof record.title !== "string") return null
  const status = record.status === "DRAFT" || record.status === "ARCHIVED" || record.status === "ACTIVE" ? record.status : "ACTIVE"
  const tags = Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string").join(", ") : typeof record.tags === "string" ? record.tags : ""
  const options = asArray(record.options)
    .map((option) => {
      const item = asRecord(option)
      if (!item || typeof item.name !== "string") return null
      return {
        id: typeof item.id === "string" ? item.id : "",
        name: item.name,
        values: optionValues(item),
      }
    })
    .filter((option): option is CatalogOption => option != null)
  const variantNodes = asArray(asRecord(record.variants)?.nodes)
  const variants = variantNodes
    .map((variant) => {
      const item = asRecord(variant)
      if (!item || typeof item.id !== "string") return null
      const selected = asArray(item.selectedOptions)
        .map((option) => {
          const pair = asRecord(option)
          if (!pair || typeof pair.name !== "string" || typeof pair.value !== "string") return null
          return { name: pair.name, value: pair.value }
        })
        .filter((option): option is { name: string; value: string } => option != null)
      return {
        id: item.id,
        numericId: gidNumber(item.id),
        title: typeof item.title === "string" ? item.title : selected.map((option) => option.value).join(" / ") || "Default Title",
        price: item.price == null ? "0.00" : String(item.price),
        sku: typeof item.sku === "string" ? item.sku : null,
        selectedOptions: selected,
      }
    })
    .filter((variant): variant is CatalogVariant => variant != null)
  const metafield = asRecord(record.metafield)
  const imageUrl = asRecord(asRecord(asRecord(record.featuredMedia)?.preview)?.image)?.url
  return {
    id: record.id,
    numericId: gidNumber(record.id),
    title: record.title,
    handle: typeof record.handle === "string" ? record.handle : "",
    status,
    productType: typeof record.productType === "string" ? record.productType : "",
    tags,
    options: partial ? [] : options,
    variants: partial ? [] : variants,
    jsonLd: typeof metafield?.value === "string" ? metafield.value : null,
    image: typeof imageUrl === "string" ? imageUrl : null,
  }
}

function productSetInput(product: CatalogProduct, keepIds: boolean): Record<string, unknown> {
  const options = product.options.length > 0 ? product.options : [{ id: "", name: "Title", values: ["Default Title"] }]
  return {
    productOptions: options.map((option) => ({
      name: option.name,
      values: option.values.map((name) => ({ name })),
    })),
    variants: product.variants.map((variant) => {
      const selected =
        variant.selectedOptions.length > 0
          ? variant.selectedOptions
          : [{ name: options[0]?.name ?? "Title", value: variant.title || "Default Title" }]
      return {
        ...(keepIds ? { id: variant.id } : {}),
        ...(variant.sku ? { sku: variant.sku } : {}),
        price: variant.price,
        optionValues: selected.map((option) => ({ optionName: option.name, name: option.value })),
      }
    }),
  }
}

export function productSetVariables(product: CatalogProduct, keepIds: boolean): Record<string, unknown> {
  return {
    synchronous: true,
    identifier: { id: product.id },
    input: productSetInput(product, keepIds),
  }
}

/**
 * Admin API port. `read` is the snapshot. `restore` writes that snapshot back
 * and is safe to retry: every call sets the stored original, it does not toggle.
 */
export class LivePort {
  readonly dryRun = false

  constructor(
    private readonly graphql: AdminGraphql,
    readonly shop: string,
  ) {}

  async read(): Promise<StoreRead> {
    const viz: CatalogProduct[] = []
    let cursor: string | null = null
    let shippingHtml: string | null = null
    let refundHtml: string | null = null
    let ghosts: CatalogProduct[] = []
    for (let page = 0; page < 4; page += 1) {
      const data = await this.graphql(READ_QUERY, { ghostQuery: "title:*Ghost*", vizQuery: "title:VIZ*", cursor })
      const root = asRecord(data)
      if (!root) throw new Error("Shopify Admin read returned no data")
      if (page === 0) {
        const policies = asArray(asRecord(root.shop)?.shopPolicies)
        for (const policy of policies) {
          const item = asRecord(policy)
          if (!item || typeof item.body !== "string") continue
          if (item.type === "SHIPPING_POLICY") shippingHtml = item.body
          if (item.type === "REFUND_POLICY") refundHtml = item.body
        }
        ghosts = asArray(asRecord(root.ghost)?.nodes)
          .map((node) => parseProduct(node))
          .filter((product): product is CatalogProduct => product != null)
          .filter((product) => isGhost18(asShopify(product)))
      }
      const vizConn = asRecord(root.viz)
      for (const node of asArray(vizConn?.nodes)) {
        const product = parseProduct(node, true)
        if (product && isExperimentTitle(product.title)) viz.push(product)
      }
      const pageInfo = asRecord(vizConn?.pageInfo)
      if (pageInfo?.hasNextPage !== true || typeof pageInfo.endCursor !== "string") break
      cursor = pageInfo.endCursor
    }
    const products = [...ghosts, ...viz.filter((product) => !ghosts.some((ghost) => ghost.id === product.id))]
    return {
      shop: this.shop,
      shippingHtml,
      shippingText: shippingHtml ? stripHtml(shippingHtml) || null : null,
      refundHtml,
      refundText: refundHtml ? stripHtml(refundHtml) || null : null,
      products,
    }
  }

  async writePolicy(type: PolicyType, html: string): Promise<void> {
    const data = await this.graphql(POLICY_MUTATION, { shopPolicy: { type, body: html } })
    assertOk(data, "shopPolicyUpdate", "shopPolicyUpdate")
  }

  async addSizes(product: CatalogProduct, sizes: readonly string[]): Promise<void> {
    const sizeOption = product.options.find((option) => option.name.toLowerCase() === "size")
    const missing = sizes.filter((size) => !sizeOption?.values.some((value) => value.toLowerCase() === size.toLowerCase()))
    const price = product.variants[0]?.price ?? "0.00"
    if (!sizeOption) {
      const data = await this.graphql(OPTIONS_CREATE, {
        productId: product.id,
        variantStrategy: "CREATE",
        options: [{ name: "Size", values: sizes.map((name) => ({ name })) }],
      })
      const payload = assertOk(data, "productOptionsCreate", "productOptionsCreate")
      await this.syncPrices(product.id, payload, price)
      return
    }
    if (missing.length === 0) return
    const data = await this.graphql(OPTION_UPDATE, {
      productId: product.id,
      option: { id: sizeOption.id },
      optionValuesToAdd: missing.map((name) => ({ name })),
      variantStrategy: "CREATE",
    })
    assertOk(data, "productOptionUpdate", "productOptionUpdate")
  }

  private async syncPrices(productId: string, payload: Record<string, unknown>, price: string): Promise<void> {
    const nodes = asArray(asRecord(asRecord(payload.product)?.variants)?.nodes)
    const variants = nodes
      .map((node) => asRecord(node))
      .filter((node): node is Record<string, unknown> => node != null && typeof node.id === "string")
      .filter((node) => String(node.price ?? "") !== price)
      .map((node) => ({ id: node.id as string, price }))
    if (variants.length === 0) return
    const data = await this.graphql(VARIANTS_UPDATE, { productId, variants })
    assertOk(data, "productVariantsBulkUpdate", "productVariantsBulkUpdate")
  }

  async updateProduct(id: string, patch: { title?: string; status?: ProductStatus }): Promise<void> {
    const data = await this.graphql(PRODUCT_UPDATE, { product: { id, ...patch } })
    assertOk(data, "productUpdate", "productUpdate")
  }

  async setJsonLd(productId: string, json: string): Promise<void> {
    const data = await this.graphql(METAFIELDS_SET, {
      metafields: [{ ownerId: productId, namespace: JSONLD_NAMESPACE, key: JSONLD_KEY, type: "json", value: json }],
    })
    assertOk(data, "metafieldsSet", "metafieldsSet")
  }

  async deleteJsonLd(productId: string): Promise<void> {
    const data = await this.graphql(METAFIELDS_DELETE, {
      metafields: [{ ownerId: productId, namespace: JSONLD_NAMESPACE, key: JSONLD_KEY }],
    })
    assertOk(data, "metafieldsDelete", "metafieldsDelete")
  }

  async restoreProduct(product: CatalogProduct): Promise<void> {
    const withIds = productSetVariables(product, true)
    try {
      const data = await this.graphql(PRODUCT_SET, withIds)
      assertOk(data, "productSet", "productSet")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/not found|does not exist|could not find/i.test(message)) throw error
      const data = await this.graphql(PRODUCT_SET, productSetVariables(product, false))
      assertOk(data, "productSet", "productSet")
    }
  }

  async restore(baseline: StoreRead, ops: AppliedOp[]): Promise<void> {
    const sizes = ops.filter((op) => op.kind === "sizes")
    for (const op of sizes) {
      const product = baseline.products.find((item) => item.id === op.productId)
      if (product) await this.restoreProduct(product)
    }
    for (const op of ops) {
      if (op.kind === "viz") {
        const product = baseline.products.find((item) => item.id === op.productId)
        if (product) await this.updateProduct(product.id, { title: product.title, status: product.status })
      }
    }
    for (const op of ops) {
      if (op.kind !== "jsonld") continue
      const product = baseline.products.find((item) => item.id === op.productId)
      if (!product) continue
      if (product.jsonLd == null) await this.deleteJsonLd(product.id)
      else await this.setJsonLd(product.id, product.jsonLd)
    }
    if (ops.some((op) => op.kind === "shipping")) {
      await this.writePolicy("SHIPPING_POLICY", baseline.shippingHtml ?? "")
    }
    if (ops.some((op) => op.kind === "refund")) {
      await this.writePolicy("REFUND_POLICY", baseline.refundHtml ?? "")
    }
  }
}

/** No-op port. The engine keeps the dry-run catalog itself. Used only when the admin token is absent. */
export class MemoryPort {
  readonly dryRun = true

  constructor(readonly shop: string) {}

  async read(): Promise<StoreRead> {
    return seedDefects(this.shop)
  }

  async writePolicy(_type: PolicyType, _html: string): Promise<void> {}

  async addSizes(_product: CatalogProduct, _sizes: readonly string[]): Promise<void> {}

  async updateProduct(_id: string, _patch: { title?: string; status?: ProductStatus }): Promise<void> {}

  async setJsonLd(_productId: string, _json: string): Promise<void> {}

  async deleteJsonLd(_productId: string): Promise<void> {}

  async restoreProduct(_product: CatalogProduct): Promise<void> {}

  async restore(_baseline: StoreRead, _ops: AppliedOp[]): Promise<void> {}
}

/** Broken Ghost 18 catalog so the no-token path can still rehearse approve, apply, and revert. */
export function seedDefects(shop: string): StoreRead {
  const ghost: CatalogProduct = {
    id: "gid://shopify/Product/18",
    numericId: 18,
    title: "Brooks Men's Ghost 18 Running Shoes",
    handle: "brooks-mens-ghost-18-running-shoes",
    status: "ACTIVE",
    productType: "Running shoes",
    tags: "brooks, running, ghost",
    options: [{ id: "gid://shopify/ProductOption/1", name: "Title", values: ["Default Title"] }],
    variants: [
      {
        id: "gid://shopify/ProductVariant/1800",
        numericId: 1800,
        title: "Default Title",
        price: "152.00",
        sku: "GHOST18",
        selectedOptions: [{ name: "Title", value: "Default Title" }],
      },
    ],
    jsonLd: null,
    image: "https://cdn.shopify.com/s/files/ghost-18.jpg",
  }
  const viz = Array.from({ length: 23 }, (_, index) => {
    const n = index + 1
    return {
      id: `gid://shopify/Product/${1000 + n}`,
      numericId: 1000 + n,
      title: `VIZ V${n}`,
      handle: `viz-v${n}`,
      status: "ACTIVE" as const,
      productType: "A/B test",
      tags: "experiment, viz",
      options: [{ id: `gid://shopify/ProductOption/viz-${n}`, name: "Title", values: ["Default Title"] }],
      variants: [
        {
          id: `gid://shopify/ProductVariant/${5000 + n}`,
          numericId: 5000 + n,
          title: "Default Title",
          price: (48 + n).toFixed(2),
          sku: `VIZ-V${n}`,
          selectedOptions: [{ name: "Title", value: "Default Title" }],
        },
      ],
      jsonLd: null,
      image: `https://cdn.shopify.com/s/files/viz-v${n}.jpg`,
    }
  })
  return {
    shop,
    shippingHtml: "<p>We ship worldwide.</p>",
    shippingText: "We ship worldwide.",
    refundHtml: null,
    refundText: null,
    products: [ghost, ...viz],
  }
}

export function textsMatch(left: string | null, right: string | null): boolean {
  return (left ? stripHtml(left) : "") === (right ? stripHtml(right) : "")
}

/** What a live re-read must show after revert. Empty means the snapshot is back. */
export function revertDrift(baseline: StoreRead, seen: StoreRead, ops: AppliedOp[]): string[] {
  const problems: string[] = []
  if (ops.some((op) => op.kind === "shipping") && !textsMatch(baseline.shippingHtml, seen.shippingHtml)) {
    problems.push("shipping policy")
  }
  if (ops.some((op) => op.kind === "refund") && !textsMatch(baseline.refundHtml, seen.refundHtml)) {
    problems.push("refund policy")
  }
  for (const op of ops) {
    if (op.kind === "viz") {
      const before = baseline.products.find((product) => product.id === op.productId)
      const after = seen.products.find((product) => product.id === op.productId)
      if (!before || !after || before.title !== after.title || before.status !== after.status) problems.push(before?.title ?? op.productId)
    }
    if (op.kind === "sizes") {
      const before = baseline.products.find((product) => product.id === op.productId)
      const after = seen.products.find((product) => product.id === op.productId)
      const beforeSizes = (before?.options.find((option) => option.name.toLowerCase() === "size")?.values ?? []).slice().sort().join(",")
      const afterSizes = (after?.options.find((option) => option.name.toLowerCase() === "size")?.values ?? []).slice().sort().join(",")
      if (beforeSizes !== afterSizes) problems.push("Ghost 18 sizes")
    }
    if (op.kind === "jsonld") {
      const before = baseline.products.find((product) => product.id === op.productId)?.jsonLd ?? null
      const after = seen.products.find((product) => product.id === op.productId)?.jsonLd ?? null
      if ((before == null) !== (after == null)) problems.push("JSON-LD metafield")
    }
  }
  return problems
}

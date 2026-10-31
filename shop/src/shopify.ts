import { blankEvidence, type StoreEvidence } from "@readiness/protocol"
import { experimentRatio } from "./catalog.js"
import { shopUrlFromEnv, storefrontPasswordFromEnv } from "./env.js"
import { passwordUnlockSucceeded, scrapeAuthenticityToken, storefrontPasswordBody } from "./password.js"

/** Variant row from Shopify's public `/products.json` feed. */
export interface ShopifyVariant {
  id: number
  title: string
  option1: string | null
  option2: string | null
  option3: string | null
  price: string
  available: boolean
  sku: string | null
}

/** Product row from `/products.json`. `tags` is a comma-separated string on that endpoint. */
export interface ShopifyProduct {
  id: number
  title: string
  handle: string
  body_html: string | null
  product_type: string
  tags: string | string[]
  options: { name: string; values: string[] }[]
  variants: ShopifyVariant[]
  images: { src: string }[]
}

export interface StorefrontSnapshot {
  origin: string
  products: ShopifyProduct[]
  evidence: StoreEvidence
}

const JSON_HEADERS = {
  accept: "application/json,text/plain,*/*",
  "user-agent": "agent-readiness-audit/0.1",
}

export function originOf(storeUrl: string): string {
  const url = new URL(storeUrl)
  return url.origin
}

export function textOf(product: ShopifyProduct): string {
  const tags = Array.isArray(product.tags) ? product.tags.join(" ") : product.tags
  const options = product.options.flatMap((option) => [option.name, ...option.values])
  return [product.title, product.product_type, tags, product.body_html ?? "", ...options].join(" ")
}

export function mentions(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export function hasOptionValue(product: ShopifyProduct, optionName: string, value: string): boolean {
  return product.options.some(
    (option) =>
      option.name.toLowerCase() === optionName.toLowerCase() &&
      option.values.some((optionValue) => optionValue.toLowerCase() === value.toLowerCase()),
  )
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function disclosesShippingPrice(text: string): boolean {
  return /\$\s?\d+|\bfree shipping\b|\bfree over\b|\bfree on orders\b/i.test(text)
}

export function disclosesShippingEta(text: string): boolean {
  return /\b\d+\s*[–-]\s*\d+\s*(business\s+)?days\b|\bwithin\s+\d+\s+(business\s+)?days\b|\barrives in\b/i.test(text)
}

export function refundWindowDays(text: string): number | null {
  const match = text.match(/\b(\d+)\s*-?\s*days?\b/i)
  if (!match) return null
  const days = Number(match[1])
  return Number.isFinite(days) ? days : null
}

export function parseProductsJson(body: unknown): ShopifyProduct[] {
  if (!body || typeof body !== "object" || !("products" in body)) return []
  const products = (body as { products: unknown }).products
  return Array.isArray(products) ? (products as ShopifyProduct[]) : []
}

export class CookieJar {
  private readonly pairs = new Map<string, string>()

  absorb(response: Response): void {
    const extended = response.headers as Headers & { getSetCookie?: () => string[] }
    const lines = extended.getSetCookie?.call(response.headers) ?? splitSetCookie(response.headers.get("set-cookie"))
    for (const line of lines) {
      const pair = line.split(";")[0] ?? ""
      const eq = pair.indexOf("=")
      if (eq <= 0) continue
      this.pairs.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }

  header(): string | undefined {
    if (this.pairs.size === 0) return undefined
    return [...this.pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ")
  }
}

function splitSetCookie(header: string | null): string[] {
  if (!header) return []
  return header.split(/,(?=\s*[^;,=\s]+=)/)
}

async function getText(url: string, jar: CookieJar, timeoutMs = 12_000): Promise<{ response: Response; text: string }> {
  const cookie = jar.header()
  const response = await fetch(url, {
    headers: cookie ? { ...JSON_HEADERS, cookie } : JSON_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })
  jar.absorb(response)
  return { response, text: await response.text() }
}

function looksLikePasswordWall(finalUrl: string, body: string): boolean {
  const url = finalUrl.toLowerCase()
  const text = body.toLowerCase()
  return url.includes("/password") || text.includes("enter using password") || text.includes("opening soon")
}

/**
 * GET /password, then POST the storefront password form. Keeps every Set-Cookie,
 * including the one on the 302. Does not log the password.
 */
export async function unlockStorefront(origin: string, jar: CookieJar, password: string): Promise<boolean> {
  const page = await getText(`${origin}/password`, jar)
  const token = scrapeAuthenticityToken(page.text)
  const response = await fetch(`${origin}/password`, {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "content-type": "application/x-www-form-urlencoded",
      origin,
      referer: `${origin}/password`,
      "user-agent": JSON_HEADERS["user-agent"],
      ...(jar.header() ? { cookie: jar.header()! } : {}),
    },
    body: storefrontPasswordBody(password, token),
    signal: AbortSignal.timeout(12_000),
  })
  jar.absorb(response)
  const body = await response.text()
  return passwordUnlockSucceeded(response.status, response.headers.get("location"), body)
}

async function ensureUnlocked(origin: string, jar: CookieJar, password: string | undefined): Promise<"open" | "unlocked" | "blocked"> {
  if (!password) return "open"
  const ok = await unlockStorefront(origin, jar, password)
  return ok ? "unlocked" : "blocked"
}

function looksLikeBotWall(body: string): boolean {
  const text = body.toLowerCase()
  return text.includes("captcha") || text.includes("verify you are human") || text.includes("access denied")
}

/**
 * Read the public Online Store surfaces an agent can use without a token.
 * Confirmed October 2026: `GET /products.json` still returns 200 on a real
 * Online Store (probed `https://www.kyliecosmetics.com/products.json`).
 * `*.mock.shop` catalogs do not serve this route; they are Storefront GraphQL only.
 */
export async function auditStorefront(storeUrl: string = shopUrlFromEnv(), password: string | undefined = storefrontPasswordFromEnv()): Promise<StorefrontSnapshot> {
  const origin = originOf(storeUrl)
  const jar = new CookieJar()
  const evidence = blankEvidence(origin)

  let products: ShopifyProduct[] = []
  try {
    const gate = await ensureUnlocked(origin, jar, password)
    if (gate === "blocked") {
      evidence.http.passwordWall = true
      return { origin, products, evidence }
    }
    for (let page = 1; page <= 4; page += 1) {
      const result = await getText(`${origin}/products.json?limit=250&page=${page}`, jar)
      if (looksLikePasswordWall(result.response.url, result.text)) {
        evidence.http.passwordWall = true
        return { origin, products, evidence }
      }
      if (!result.response.ok) {
        evidence.http.productsJsonOk = false
        break
      }
      const batch = parseProductsJson(JSON.parse(result.text) as unknown)
      products = [...products, ...batch]
      evidence.http.productsJsonOk = products.length > 0
      if (batch.length < 250) break
    }
  } catch {
    evidence.http.unreachable = true
    return { origin, products, evidence }
  }

  evidence.catalog.productCount = products.length
  if (products.length > 0) {
    const priced = products.filter((product) =>
      product.variants.every((variant) => Number(variant.price) > 0),
    ).length
    const imaged = products.filter((product) => product.images.length > 0).length
    evidence.catalog.pricedRatio = priced / products.length
    evidence.catalog.imagedRatio = imaged / products.length
    evidence.catalog.experimentRatio = experimentRatio(products)
  }

  try {
    const search = await getText(
      `${origin}/search/suggest.json?q=ghost&resources%5Btype%5D=product&resources%5Blimit%5D=8`,
      jar,
    )
    evidence.http.searchOk = search.response.ok && search.text.includes("products")
  } catch {
    evidence.http.searchOk = false
  }

  try {
    const robots = await getText(`${origin}/robots.txt`, jar)
    const body = robots.text.toLowerCase()
    evidence.http.robotsBlocksAgents =
      robots.response.ok &&
      (/user-agent:\s*\*\s+disallow:\s*\//i.test(robots.text) ||
        /user-agent:\s*(gptbot|claudebot|perplexitybot|google-extended)[\s\S]{0,80}disallow:\s*\//i.test(body))
  } catch {
    evidence.http.robotsBlocksAgents = false
  }

  const sample = products[0]
  if (sample) {
    try {
      const page = await getText(`${origin}/products/${sample.handle}`, jar)
      evidence.http.productJsonLd = /"@type"\s*:\s*"Product"/i.test(page.text)
    } catch {
      evidence.http.productJsonLd = false
    }
  }

  const shipping = await readPolicy(origin, "shipping-policy", jar)
  const refund = await readPolicy(origin, "refund-policy", jar)
  evidence.policies.shippingText = shipping
  evidence.policies.refundText = refund
  const shippingHaystack = shipping ?? ""
  evidence.policies.shippingPriceDisclosed = disclosesShippingPrice(shippingHaystack)
  evidence.policies.shippingEtaDisclosed = disclosesShippingEta(shippingHaystack)
  evidence.policies.refundWindowDays = refund ? refundWindowDays(refund) : null

  const variant = products.flatMap((product) => product.variants).find((item) => item.available)
  if (variant) {
    evidence.checkout.attempted = true
    try {
      const probe = await getText(`${origin}/cart/${variant.id}:1`, jar, 15_000)
      const finalUrl = probe.response.url.toLowerCase()
      evidence.checkout.botWall = looksLikeBotWall(probe.text)
      evidence.checkout.reached = finalUrl.includes("checkout") && !evidence.checkout.botWall
    } catch {
      evidence.checkout.reached = false
    }
  }

  return { origin, products, evidence }
}

async function readPolicy(origin: string, handle: string, jar: CookieJar): Promise<string | null> {
  try {
    const result = await getText(`${origin}/policies/${handle}`, jar)
    if (!result.response.ok) return null
    if (looksLikePasswordWall(result.response.url, result.text)) return null
    const text = stripHtml(result.text)
    return text.length > 0 ? text.slice(0, 4_000) : null
  } catch {
    return null
  }
}

/**
 * Ajax cart add. Call this from a shopper after it has chosen a variant.
 * Keeps its own cookie jar for one shopper session.
 */
export async function addToCart(origin: string, variantId: number, quantity = 1, password: string | undefined = storefrontPasswordFromEnv()): Promise<{ ok: boolean; status: number; body: string }> {
  const jar = new CookieJar()
  if (password) {
    const opened = await unlockStorefront(origin, jar, password)
    if (!opened) return { ok: false, status: 401, body: "storefront password was rejected" }
  }
  await getText(`${origin}/cart.js`, jar).catch(() => undefined)
  const cookie = jar.header()
  const response = await fetch(`${origin}/cart/add.js`, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ items: [{ id: variantId, quantity }] }),
    signal: AbortSignal.timeout(12_000),
  })
  const body = await response.text()
  return { ok: response.ok, status: response.status, body }
}

import type { ShopifyProduct, ShopifyVariant } from "./shopify.js"

export const SPEC_SIZE = "10"

export function isExperimentTitle(title: string): boolean {
  return /^VIZ\b/i.test(title.trim())
}

export function isGhost18(product: ShopifyProduct): boolean {
  return /ghost\s*18/i.test(product.title) && !isExperimentTitle(product.title)
}

export function experimentRatio(products: ShopifyProduct[]): number {
  if (products.length === 0) return 0
  const hits = products.filter((product) => isExperimentTitle(product.title)).length
  return hits / products.length
}

export function cheapestAvailable(product: ShopifyProduct): ShopifyVariant | undefined {
  return product.variants
    .filter((variant) => variant.available && Number(variant.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price))[0]
}

export function cheapestGhost(products: ShopifyProduct[]): { product: ShopifyProduct; variant: ShopifyVariant } | null {
  const ranked = products
    .filter(isGhost18)
    .map((product) => ({ product, variant: cheapestAvailable(product) }))
    .filter((item): item is { product: ShopifyProduct; variant: ShopifyVariant } => item.variant != null)
    .sort((a, b) => Number(a.variant.price) - Number(b.variant.price))
  return ranked[0] ?? null
}

export function variantForSize(product: ShopifyProduct, size: string): ShopifyVariant | undefined {
  const wanted = size.toLowerCase()
  return product.variants.find((variant) => {
    const values = [variant.title, variant.option1, variant.option2, variant.option3]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
    return values.some((value) => value === wanted || value.startsWith(`${wanted} `) || value.startsWith(`${wanted}/`))
  })
}

export function hasShoeSize(product: ShopifyProduct, size: string): boolean {
  return variantForSize(product, size) != null
}

export function descriptionWords(product: ShopifyProduct): number {
  const text = (product.body_html ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
  return text.split(/\s+/).filter(Boolean).length
}

/** Share of products with fewer than 40 words of description text. */
export function thinDescriptionRatio(products: ShopifyProduct[]): number {
  if (products.length === 0) return 0
  return products.filter((product) => descriptionWords(product) < 40).length / products.length
}

/** Titles that appear on more than one product with a different lowest price. */
export function conflictingTitleCount(products: ShopifyProduct[]): number {
  const prices = new Map<string, Set<string>>()
  for (const product of products) {
    const key = product.title.trim().toLowerCase().replace(/\s+/g, " ")
    const low = cheapestAvailable(product)?.price ?? product.variants[0]?.price
    if (!key || low == null) continue
    const set = prices.get(key) ?? new Set<string>()
    set.add(Number(low).toFixed(2))
    prices.set(key, set)
  }
  return [...prices.values()].filter((set) => set.size > 1).length
}

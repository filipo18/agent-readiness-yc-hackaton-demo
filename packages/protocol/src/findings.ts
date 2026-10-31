/** Stable codes. Shoppers, the report actor, and the dashboard all use these strings. */
export const FINDING_CODES = [
  "STORE_UNREACHABLE",
  "STORE_PASSWORD_WALL",
  "PRODUCTS_JSON_MISSING",
  "SEARCH_UNUSABLE",
  "NO_PRODUCT_JSONLD",
  "ROBOTS_BLOCKS_AGENTS",
  "PRICE_MISSING",
  "IMAGE_MISSING",
  "VARIANT_SPEC_UNMATCHED",
  "COLOR_NOT_IN_TEXT",
  "EXPERIMENT_TITLES",
  "SIZE_OPTION_MISSING",
  "CART_ADD_FAILED",
  "SHIPPING_HIDDEN_UNTIL_CHECKOUT",
  "SHIPPING_ETA_MISSING",
  "RETURNS_POLICY_MISSING",
  "RETURNS_WINDOW_MISSING",
  "CHECKOUT_UNREACHABLE",
  "CHECKOUT_BOT_WALL",
  "LISTING_DETAIL_THIN",
  "CONFLICTING_LISTINGS",
] as const

export type FindingCode = (typeof FINDING_CODES)[number]

export type FindingSeverity = "blocker" | "major" | "minor"

export interface Finding {
  code: FindingCode
  severity: FindingSeverity
  /** Short line for the dashboard and for #findings. */
  summary: string
  /** What to change in the store. Deterministic; not an LLM paragraph. */
  fix: string
  /** Personas that observed it. Deduped by the report actor. */
  personas: string[]
  /** Evidence from Filip's LLM shopping experiments, when one applies. */
  why?: ResearchNote
}

export interface ResearchNote {
  experiment: string
  stat: string
}

export const FIX_COPY: Record<FindingCode, { severity: FindingSeverity; summary: string; fix: string }> = {
  STORE_UNREACHABLE: {
    severity: "blocker",
    summary: "The store URL did not respond.",
    fix: "Confirm the public https origin. Agents cannot audit a store they cannot fetch.",
  },
  STORE_PASSWORD_WALL: {
    severity: "blocker",
    summary: "The storefront password blocked the audit.",
    fix: "Set SHOP_STOREFRONT_PASSWORD so this dev store can be entered. A public store should turn the password page off. Agents without the password stop here.",
  },
  PRODUCTS_JSON_MISSING: {
    severity: "blocker",
    summary: "GET /products.json did not return a product list.",
    fix: "Publish the Online Store and keep the Shopify product JSON feed reachable. It is the reliable catalog API for agents.",
  },
  SEARCH_UNUSABLE: {
    severity: "major",
    summary: "Predictive search returned nothing useful for a plain product query.",
    fix: "Make /search/suggest.json return products for title words. Put color, size, and product type in the title or tags, not only in images.",
  },
  NO_PRODUCT_JSONLD: {
    severity: "minor",
    summary: "Product pages have no Product JSON-LD.",
    fix: "Emit schema.org/Product JSON-LD with name, image, offers.price, and availability.",
  },
  ROBOTS_BLOCKS_AGENTS: {
    severity: "major",
    summary: "robots.txt disallows agent crawlers or the whole site.",
    fix: "Allow shopping agents to read catalog, policy, and product URLs. Publish an explicit policy instead of Disallow: /.",
  },
  PRICE_MISSING: {
    severity: "blocker",
    summary: "At least one product has no numeric price.",
    fix: "Set a price on every variant. Agents will not guess a price from an image.",
  },
  IMAGE_MISSING: {
    severity: "minor",
    summary: "At least one product has no image.",
    fix: "Attach an image. Keep the purchase decision in text as well, because some agents never open the image.",
  },
  VARIANT_SPEC_UNMATCHED: {
    severity: "major",
    summary: "A shopper could not match the requested variant from structured options.",
    fix: "Expose the spec as a variant option with a plain name (Size, Color, Capacity) and values, not as a photo or a PDF.",
  },
  COLOR_NOT_IN_TEXT: {
    severity: "major",
    summary: "Color is not in the product title, tags, or option values.",
    fix: "Put the color in the title and in a Color option. A color that exists only in the photo is invisible to an agent.",
  },
  EXPERIMENT_TITLES: {
    severity: "major",
    summary: "Many products are titled like A/B tests (VIZ V…) instead of a name a shopper would say.",
    fix: "Keep experiment rows out of the Online Store. One shopper-facing title for Brooks Ghost 18. VIZ variants belong in an unpublished draft or a tag, not the product title.",
  },
  SIZE_OPTION_MISSING: {
    severity: "major",
    summary: "The requested size is not a selectable variant option.",
    fix: "Add a Size option whose values match what shoppers say (S, M, L, or the exact measurement).",
  },
  CART_ADD_FAILED: {
    severity: "blocker",
    summary: "The matching variant could not be added to the cart.",
    fix: "Accept POST /cart/add.js for an available variant id. Return the line item. Do not require a theme click to build a cart.",
  },
  SHIPPING_HIDDEN_UNTIL_CHECKOUT: {
    severity: "major",
    summary: "Shipping price is not stated before checkout.",
    fix: "Write the rate in the shipping policy and on the product: for example \"Flat rate $6, free over $75.\" Cart JSON does not include rates.",
  },
  SHIPPING_ETA_MISSING: {
    severity: "major",
    summary: "No delivery window is stated before checkout.",
    fix: "State a delivery window in days in the shipping policy, such as \"Arrives in 3–5 business days.\"",
  },
  RETURNS_POLICY_MISSING: {
    severity: "major",
    summary: "No refund policy text is published.",
    fix: "Publish /policies/refund-policy as HTML text. A footer image or PDF does not count.",
  },
  RETURNS_WINDOW_MISSING: {
    severity: "major",
    summary: "The refund policy does not state a window in days.",
    fix: "Say the number of days, such as \"30-day returns.\" Agents should not have to infer a window.",
  },
  CHECKOUT_UNREACHABLE: {
    severity: "blocker",
    summary: "The cart permalink never reached a checkout URL.",
    fix: "Let /cart/{variant}:{qty} redirect to checkout without a password, an interstitial, or a dead end.",
  },
  CHECKOUT_BOT_WALL: {
    severity: "major",
    summary: "Checkout responded with a bot wall.",
    fix: "Allow a checkout session that was created from the Ajax cart. Stop before payment; do not require a human captcha to see shipping.",
  },
  LISTING_DETAIL_THIN: {
    severity: "major",
    summary: "Many product descriptions are under 40 words.",
    fix: "Write the decision facts in the description text: fit, use, materials, drop, weight, care. Agents rank on what the listing says.",
  },
  CONFLICTING_LISTINGS: {
    severity: "major",
    summary: "The same product title is listed at different prices.",
    fix: "Merge duplicate listings into one product with variants, or give each a distinct title. Conflicting copies of one offer read as unreliable.",
  },
}

/**
 * Research-backed context. Every number is quoted from Filip's experiments
 * (8 LLMs ranking 25 running-shoe offers). Nothing here is extrapolated.
 */
export const RESEARCH: Partial<Record<FindingCode, ResearchNote>> = {
  LISTING_DETAIL_THIN: {
    experiment: "Experiment 3 · fixed $150, balanced order",
    stat: "Missing or less useful information was a stated reason against an offer in 591 of 2,000 explanations (29.55%).",
  },
  CONFLICTING_LISTINGS: {
    experiment: "Experiment 3 · fixed $150, balanced order",
    stat: "Conflicting information was a stated reason against an offer in 172 of 2,000 explanations (8.60%).",
  },
  VARIANT_SPEC_UNMATCHED: {
    experiment: "Experiment 2 · fixed price $150",
    stat: "Product suitability was the primary reason for 96.7% of first-place picks (58 of 60).",
  },
  SIZE_OPTION_MISSING: {
    experiment: "Experiment 2 · fixed price $150",
    stat: "Product suitability was the primary reason for 96.7% of first-place picks (58 of 60).",
  },
  COLOR_NOT_IN_TEXT: {
    experiment: "Experiment 4 · input position",
    stat: "Listing completeness was cited in 20.0% of 6,000 offer-level reasons (1,201).",
  },
  PRICE_MISSING: {
    experiment: "Running-shoe ranking repeatability vs Experiment 2",
    stat: "Price/value led 70% of first-place explanations (42 of 60); with every price fixed at $150 it fell to 0%.",
  },
  SEARCH_UNUSABLE: {
    experiment: "Experiment 4 · input position",
    stat: "Appearing first instead of fifth won the #1 pick 90.0 pp more often [85.7, 94.0] across 8 models.",
  },
  EXPERIMENT_TITLES: {
    experiment: "Experiment 4 · input position",
    stat: "Earlier position improved average rank by 3.31 places [3.12, 3.48].",
  },
}

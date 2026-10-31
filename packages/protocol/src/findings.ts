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
  "SIZE_OPTION_MISSING",
  "CART_ADD_FAILED",
  "SHIPPING_HIDDEN_UNTIL_CHECKOUT",
  "SHIPPING_ETA_MISSING",
  "RETURNS_POLICY_MISSING",
  "RETURNS_WINDOW_MISSING",
  "CHECKOUT_UNREACHABLE",
  "CHECKOUT_BOT_WALL",
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
}

export const FIX_COPY: Record<FindingCode, { severity: FindingSeverity; summary: string; fix: string }> = {
  STORE_UNREACHABLE: {
    severity: "blocker",
    summary: "The store URL did not respond.",
    fix: "Confirm the public https origin. Agents cannot audit a store they cannot fetch.",
  },
  STORE_PASSWORD_WALL: {
    severity: "blocker",
    summary: "The storefront is behind a password page.",
    fix: "Disable the storefront password before expecting agents to shop. A password wall is a zero for agent readiness.",
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
    fix: "Put the color in the title and in a Color option. A blue hoodie that is only blue in the photo is invisible to an agent.",
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
}

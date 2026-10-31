import { blankEvidence } from "@readiness/protocol"
import { isExperimentTitle } from "./catalog.js"
import { disclosesShippingEta, disclosesShippingPrice, originOf, type ShopifyProduct, type StorefrontSnapshot } from "./shopify.js"

const STORE_URL = "https://aiconvertit-demo.myshopify.com"

const SIZES = ["8", "9", "10", "11", "12"] as const

function ghost(): ShopifyProduct {
  return {
    id: 18,
    title: "Brooks Men's Ghost 18 Running Shoes",
    handle: "brooks-mens-ghost-18-running-shoes",
    body_html: "<p>Daily trainer with a cushioned ride.</p>",
    product_type: "Running shoes",
    tags: "brooks, running, ghost",
    options: [{ name: "Size", values: [...SIZES] }],
    variants: SIZES.map((size, index) => ({
      id: 1800 + index,
      title: size,
      option1: size,
      option2: null,
      option3: null,
      price: "139.95",
      available: true,
      sku: `GHOST18-${size}`,
    })),
    images: [{ src: "https://cdn.shopify.com/s/files/ghost-18.jpg" }],
  }
}

function viz(n: number): ShopifyProduct {
  return {
    id: 1000 + n,
    title: `VIZ V${n}`,
    handle: `viz-v${n}`,
    body_html: "<p>A/B test row. The title is the experiment id.</p>",
    product_type: "A/B test",
    tags: "experiment, viz",
    options: [{ name: "Title", values: ["Default Title"] }],
    variants: [
      {
        id: 5000 + n,
        title: "Default Title",
        option1: "Default Title",
        option2: null,
        option3: null,
        price: (48 + n).toFixed(2),
        available: true,
        sku: `VIZ-V${n}`,
      },
    ],
    images: [{ src: `https://cdn.shopify.com/s/files/viz-v${n}.jpg` }],
  }
}

/** 1 real Ghost 18 and 23 VIZ experiment rows. Same shape the live store suggested. */
export function fixtureProducts(): ShopifyProduct[] {
  return [ghost(), ...Array.from({ length: 23 }, (_, index) => viz(index + 1))]
}

export function fixtureSnapshot(which: "before" | "after"): StorefrontSnapshot {
  const products = fixtureProducts()
  const shippingText =
    which === "after"
      ? "Flat rate $6. Free shipping over $75. Arrives in 3–5 business days."
      : "We ship worldwide."
  const evidence = blankEvidence(STORE_URL)
  const experimentCount = products.filter((product) => isExperimentTitle(product.title)).length
  evidence.http = {
    productsJsonOk: true,
    searchOk: true,
    robotsBlocksAgents: false,
    productJsonLd: false,
    passwordWall: false,
    unreachable: false,
  }
  evidence.catalog = {
    productCount: products.length,
    pricedRatio: 1,
    imagedRatio: 1,
    experimentRatio: experimentCount / products.length,
  }
  evidence.policies = {
    shippingText,
    refundText: null,
    shippingPriceDisclosed: disclosesShippingPrice(shippingText),
    shippingEtaDisclosed: disclosesShippingEta(shippingText),
    refundWindowDays: null,
  }
  evidence.checkout = { attempted: true, reached: true, botWall: false }
  return { origin: originOf(STORE_URL), products, evidence }
}

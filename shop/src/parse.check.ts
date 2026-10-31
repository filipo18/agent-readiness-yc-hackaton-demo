import { disclosesShippingEta, disclosesShippingPrice, parseProductsJson, refundWindowDays } from "./shopify.ts"

const products = parseProductsJson({
  products: [
    {
      id: 1,
      title: "Pullover Hoodie",
      handle: "pullover-hoodie",
      body_html: "<p>Heavy fleece.</p>",
      product_type: "Hoodies",
      tags: "fleece, winter",
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      variants: [
        { id: 11, title: "M", option1: "M", option2: null, option3: null, price: "68.00", available: true, sku: "HD-M" },
      ],
      images: [{ src: "https://cdn.shopify.com/hoodie.jpg" }],
    },
  ],
})

if (products.length !== 1 || products[0]?.variants[0]?.id !== 11) {
  throw new Error("products.json parser failed")
}

const vague = "We ship worldwide."
const fixed = "Flat rate $6. Free shipping over $75. Arrives in 3–5 business days."
if (disclosesShippingPrice(vague) || disclosesShippingEta(vague)) {
  throw new Error("vague shipping copy should not count as disclosed")
}
if (!disclosesShippingPrice(fixed) || !disclosesShippingEta(fixed)) {
  throw new Error("fixed shipping copy should disclose price and ETA")
}
if (refundWindowDays("Returns accepted within 30 days of delivery.") !== 30) {
  throw new Error("refund window parser failed")
}

console.log("shop parsers ok")

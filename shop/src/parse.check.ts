import { passwordUnlockSucceeded, scrapeAuthenticityToken, storefrontPasswordBody } from "./password.ts"
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

const form = storefrontPasswordBody("s3cret", "tok+1")
if (!form.includes("form_type=storefront_password")) throw new Error("missing form_type")
if (!form.includes("utf8=%E2%9C%93")) throw new Error("utf8 checkmark was not encoded")
if (!form.includes("password=s3cret")) throw new Error("password field missing")
if (!form.includes("authenticity_token=tok%2B1")) throw new Error("token was not encoded")
const html = '<input type="hidden" name="authenticity_token" value="abc==" />'
if (scrapeAuthenticityToken(html) !== "abc==") throw new Error("token scrape failed")
if (!passwordUnlockSucceeded(302, "https://aiconvertit-demo.myshopify.com/", "")) {
  throw new Error("302 off the password page should unlock")
}
if (passwordUnlockSucceeded(302, "https://aiconvertit-demo.myshopify.com/password", "")) {
  throw new Error("302 back to /password is a rejected password")
}

console.log("shop parsers ok")

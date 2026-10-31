import { FIX_COPY, PERSONAS, type MissionEvidence, type PersonaId } from "@readiness/protocol"
import { cheapestGhost, hasShoeSize, isExperimentTitle, SPEC_SIZE, variantForSize } from "./catalog.ts"
import { askModel } from "./openai.ts"
import { addToCart, type ShopifyProduct, type StorefrontSnapshot } from "./shopify.ts"

export interface ShopAnnouncement {
  code: string
  summary: string
}

export interface ShopOutcome {
  mission: MissionEvidence
  cartVariantId: number | null
  steps: string[]
  announcements: ShopAnnouncement[]
  blockerCodes: string[]
}

export async function shopPersona(input: {
  persona: PersonaId
  snapshot: StorefrontSnapshot
  liveCart: boolean
  useModel: boolean
}): Promise<ShopOutcome> {
  const { persona, snapshot, liveCart } = input
  const products = snapshot.products
  const policies = snapshot.evidence.policies
  const spec = PERSONAS[persona]
  const ghost = cheapestGhost(products)
  const vizCount = products.filter((product) => isExperimentTitle(product.title)).length
  const model = input.useModel ? await askModel(persona, products) : null
  const modelProduct = model?.handle ? products.find((product) => product.handle === model.handle) : undefined

  if (persona === "bargain") return bargain(ghost, model, modelProduct, vizCount, liveCart, snapshot.origin)
  if (persona === "gift") return gift(ghost, policies, model, liveCart, snapshot.origin)
  if (persona === "spec") return sizeHunt(ghost, model, liveCart, snapshot.origin)
  if (persona === "impatient") return impatient(ghost, vizCount, liveCart, snapshot.origin)
  return returnsCheck(ghost, policies, liveCart, snapshot.origin, spec.goal)
}

function announce(code: keyof typeof FIX_COPY): ShopAnnouncement {
  return { code, summary: FIX_COPY[code].summary }
}

async function tryCart(origin: string, variantId: number, liveCart: boolean): Promise<boolean> {
  if (!liveCart) return true
  const result = await addToCart(origin, variantId)
  return result.ok
}

async function bargain(
  ghost: ReturnType<typeof cheapestGhost>,
  model: { handle: string | null; reason: string } | null,
  modelProduct: ShopifyProduct | undefined,
  vizCount: number,
  liveCart: boolean,
  origin: string,
): Promise<ShopOutcome> {
  const steps = [
    "Search the catalog for Brooks Ghost 18.",
    vizCount > 0 ? `Skip ${vizCount} titles that start with VIZ. Those are A/B rows.` : "No VIZ experiment titles in the first page.",
  ]
  if (model) steps.push(model.reason)
  if (modelProduct && isExperimentTitle(modelProduct.title)) {
    steps.push(`The model pointed at ${modelProduct.title}. That title is an experiment id, so it does not count.`)
  }
  if (!ghost) {
    steps.push("No Brooks Men's Ghost 18 with a shopper-facing title.")
    return done("bargain", steps, {
      matchedVariant: false,
      colorInText: false,
      sizeSelectable: false,
      cartAccepted: false,
      abandoned: true,
      cartVariantId: null,
      announcements: [announce("VARIANT_SPEC_UNMATCHED")],
    })
  }
  steps.push(`Cheapest real Ghost 18 is $${ghost.variant.price} (${ghost.product.title}).`)
  const cartAccepted = await tryCart(origin, ghost.variant.id, liveCart)
  steps.push(cartAccepted ? `Added variant ${ghost.variant.id} to the cart.` : "Cart add was rejected.")
  return done("bargain", steps, {
    matchedVariant: true,
    colorInText: true,
    sizeSelectable: hasShoeSize(ghost.product, SPEC_SIZE),
    cartAccepted,
    abandoned: !cartAccepted,
    cartVariantId: cartAccepted ? ghost.variant.id : null,
    announcements: cartAccepted ? [] : [announce("CART_ADD_FAILED")],
  })
}

async function gift(
  ghost: ReturnType<typeof cheapestGhost>,
  policies: StorefrontSnapshot["evidence"]["policies"],
  model: { reason: string } | null,
  liveCart: boolean,
  origin: string,
): Promise<ShopOutcome> {
  const steps = ["Look for a Ghost 18 to send as a gift.", "Read the shipping policy before promising Friday."]
  if (model) steps.push(model.reason)
  const shipping = policies.shippingText?.trim() || "No shipping policy text."
  steps.push(`Shipping policy: “${shipping.slice(0, 180)}”`)
  const announcements: ShopAnnouncement[] = []
  if (!policies.shippingPriceDisclosed) announcements.push(announce("SHIPPING_HIDDEN_UNTIL_CHECKOUT"))
  if (!policies.shippingEtaDisclosed) announcements.push(announce("SHIPPING_ETA_MISSING"))
  if (!ghost) {
    steps.push("Nothing titled Ghost 18 to put in the cart.")
    return done("gift", steps, {
      matchedVariant: false,
      colorInText: true,
      sizeSelectable: false,
      cartAccepted: false,
      abandoned: true,
      cartVariantId: null,
      announcements,
    })
  }
  const cartAccepted = await tryCart(origin, ghost.variant.id, liveCart)
  steps.push(
    cartAccepted
      ? policies.shippingEtaDisclosed
        ? "In the cart, and the policy states a delivery window."
        : "In the cart, but the policy never says how many days."
      : "Cart add failed.",
  )
  if (!cartAccepted) announcements.push(announce("CART_ADD_FAILED"))
  return done("gift", steps, {
    matchedVariant: true,
    colorInText: true,
    sizeSelectable: true,
    cartAccepted,
    abandoned: false,
    cartVariantId: cartAccepted ? ghost.variant.id : null,
    announcements,
  })
}

async function sizeHunt(
  ghost: ReturnType<typeof cheapestGhost>,
  model: { reason: string } | null,
  liveCart: boolean,
  origin: string,
): Promise<ShopOutcome> {
  const steps = [`Open Brooks Men's Ghost 18 and look for men's size ${SPEC_SIZE} as a variant.`]
  if (model) steps.push(model.reason)
  if (!ghost) {
    steps.push("Ghost 18 is not in the catalog under a real title.")
    return done("spec", steps, {
      matchedVariant: false,
      colorInText: true,
      sizeSelectable: false,
      cartAccepted: false,
      abandoned: true,
      cartVariantId: null,
      announcements: [announce("SIZE_OPTION_MISSING")],
    })
  }
  const variant = variantForSize(ghost.product, SPEC_SIZE)
  if (!variant) {
    steps.push(`Size ${SPEC_SIZE} is not a variant option on ${ghost.product.title}.`)
    return done("spec", steps, {
      matchedVariant: false,
      colorInText: true,
      sizeSelectable: false,
      cartAccepted: false,
      abandoned: true,
      cartVariantId: null,
      announcements: [announce("SIZE_OPTION_MISSING")],
    })
  }
  const cartAccepted = await tryCart(origin, variant.id, liveCart)
  steps.push(cartAccepted ? `Selected size ${SPEC_SIZE} and added it.` : `Size ${SPEC_SIZE} exists, but the cart rejected it.`)
  return done("spec", steps, {
    matchedVariant: true,
    colorInText: true,
    sizeSelectable: true,
    cartAccepted,
    abandoned: !cartAccepted,
    cartVariantId: cartAccepted ? variant.id : null,
    announcements: cartAccepted ? [] : [announce("CART_ADD_FAILED")],
  })
}

async function impatient(
  ghost: ReturnType<typeof cheapestGhost>,
  vizCount: number,
  liveCart: boolean,
  origin: string,
): Promise<ShopOutcome> {
  const steps = [
    "Search “ghost”.",
    vizCount > 0 ? `The first rows are VIZ experiments (${vizCount} of them).` : "Search results are real product titles.",
    "Open a VIZ row. The title is the test id, not the shoe.",
    "Back out. Scroll past the experiment rows.",
    ghost ? `Open ${ghost.product.title}.` : "The real Ghost 18 never appears.",
    "Add it, if it is a real product.",
  ]
  const announcements: ShopAnnouncement[] = []
  if (vizCount > 0) announcements.push(announce("EXPERIMENT_TITLES"))
  if (!ghost) {
    return done("impatient", steps, {
      matchedVariant: false,
      colorInText: true,
      sizeSelectable: false,
      cartAccepted: false,
      abandoned: true,
      cartVariantId: null,
      announcements,
    })
  }
  const cartAccepted = await tryCart(origin, ghost.variant.id, liveCart)
  if (!cartAccepted) announcements.push(announce("CART_ADD_FAILED"))
  return done("impatient", steps, {
    matchedVariant: true,
    colorInText: true,
    sizeSelectable: true,
    cartAccepted,
    abandoned: false,
    cartVariantId: cartAccepted ? ghost.variant.id : null,
    announcements,
  })
}

async function returnsCheck(
  ghost: ReturnType<typeof cheapestGhost>,
  policies: StorefrontSnapshot["evidence"]["policies"],
  liveCart: boolean,
  origin: string,
  _goal: string,
): Promise<ShopOutcome> {
  const steps = ["Open the refund policy before buying shoes."]
  const text = policies.refundText?.trim()
  steps.push(text ? `Refund policy: “${text.slice(0, 180)}”` : "No refund policy is published.")
  const announcements: ShopAnnouncement[] = []
  if (!text) announcements.push(announce("RETURNS_POLICY_MISSING"))
  else if (policies.refundWindowDays == null) announcements.push(announce("RETURNS_WINDOW_MISSING"))
  const allowed = policies.refundWindowDays != null && ghost != null
  if (!allowed) {
    steps.push("No day count. I will not add shoes to the cart.")
    return done("returns", steps, {
      matchedVariant: ghost != null,
      colorInText: true,
      sizeSelectable: ghost != null && hasShoeSize(ghost.product, SPEC_SIZE),
      cartAccepted: false,
      abandoned: true,
      cartVariantId: null,
      announcements,
    })
  }
  const cartAccepted = await tryCart(origin, ghost!.variant.id, liveCart)
  steps.push(cartAccepted ? `${policies.refundWindowDays}-day window is stated. Added the Ghost.` : "Policy is fine. Cart add failed.")
  if (!cartAccepted) announcements.push(announce("CART_ADD_FAILED"))
  return done("returns", steps, {
    matchedVariant: true,
    colorInText: true,
    sizeSelectable: true,
    cartAccepted,
    abandoned: !cartAccepted,
    cartVariantId: cartAccepted ? ghost!.variant.id : null,
    announcements,
  })
}

function done(
  persona: PersonaId,
  steps: string[],
  fields: {
    matchedVariant: boolean
    colorInText: boolean
    sizeSelectable: boolean
    cartAccepted: boolean
    abandoned: boolean
    cartVariantId: number | null
    announcements: ShopAnnouncement[]
  },
): ShopOutcome {
  const mission: MissionEvidence = {
    persona,
    matchedVariant: fields.matchedVariant,
    colorInText: fields.colorInText,
    sizeSelectable: fields.sizeSelectable,
    cartAccepted: fields.cartAccepted,
    steps: steps.length,
    abandoned: fields.abandoned,
  }
  return {
    mission,
    cartVariantId: fields.cartVariantId,
    steps,
    announcements: fields.announcements,
    blockerCodes: fields.announcements.map((item) => item.code),
  }
}

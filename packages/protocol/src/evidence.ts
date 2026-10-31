export const PERSONA_IDS = ["bargain", "gift", "spec", "impatient", "returns"] as const

export type PersonaId = (typeof PERSONA_IDS)[number]

export interface PersonaSpec {
  id: PersonaId
  /** One line on the dashboard card. */
  label: string
  goal: string
  needsColor: boolean
  needsSize: boolean
  needsEta: boolean
  needsReturns: boolean
  /** Impatient shopper only. Extra steps mean the path was too long. */
  maxSteps: number | null
}

export const PERSONAS: Record<PersonaId, PersonaSpec> = {
  bargain: {
    id: "bargain",
    label: "Cheapest Ghost 18",
    goal: "Add the cheapest Brooks Men's Ghost 18. Skip A/B titles that start with VIZ.",
    needsColor: false,
    needsSize: false,
    needsEta: false,
    needsReturns: false,
    maxSteps: null,
  },
  gift: {
    id: "gift",
    label: "Ghost by Friday",
    goal: "Gift a pair of Brooks Ghost 18 and confirm they can arrive within 5 days.",
    needsColor: false,
    needsSize: false,
    needsEta: true,
    needsReturns: false,
    maxSteps: null,
  },
  spec: {
    id: "spec",
    label: "Ghost 18, size 10",
    goal: "Add Brooks Men's Ghost 18 in men's size 10. Size must be a variant option.",
    needsColor: false,
    needsSize: true,
    needsEta: false,
    needsReturns: false,
    maxSteps: null,
  },
  impatient: {
    id: "impatient",
    label: "Impatient buyer",
    goal: "Add any in-stock product in four steps or fewer.",
    needsColor: false,
    needsSize: false,
    needsEta: false,
    needsReturns: false,
    maxSteps: 4,
  },
  returns: {
    id: "returns",
    label: "Returns checker",
    goal: "Read the refund policy. Add to cart only if it states a return window in days.",
    needsColor: false,
    needsSize: false,
    needsEta: false,
    needsReturns: true,
    maxSteps: null,
  },
}

/** What one shopper managed to observe. The shopper actor stores this; scoring is pure. */
export interface MissionEvidence {
  persona: PersonaId
  matchedVariant: boolean
  /** True when the needed color appears in title, tags, or option values. */
  colorInText: boolean
  sizeSelectable: boolean
  cartAccepted: boolean
  steps: number
  abandoned: boolean
}

export interface StoreEvidence {
  storeUrl: string
  http: {
    productsJsonOk: boolean
    searchOk: boolean
    robotsBlocksAgents: boolean
    productJsonLd: boolean
    passwordWall: boolean
    unreachable: boolean
  }
  catalog: {
    productCount: number
    /** Share of products with a numeric price on every variant. 0 to 1. */
    pricedRatio: number
    /** Share of products with at least one image. 0 to 1. */
    imagedRatio: number
    /**
     * Share of titles that look like experiment rows (`VIZ …`).
     * Missing means 0 so older fixtures keep their catalog score.
     */
    experimentRatio?: number
    /** Share of products whose description has fewer than 40 words. Missing means unknown. */
    thinDescriptionRatio?: number
    /** Same shopper-facing title listed at different prices. Missing means unknown. */
    conflictingTitleCount?: number
  }
  policies: {
    shippingText: string | null
    refundText: string | null
    shippingPriceDisclosed: boolean
    shippingEtaDisclosed: boolean
    refundWindowDays: number | null
  }
  checkout: {
    attempted: boolean
    reached: boolean
    botWall: boolean
  }
  missions: MissionEvidence[]
}

export interface CategoryScore {
  id: "discoverability" | "catalog" | "variantFit" | "cart" | "shipping" | "policies" | "checkout"
  label: string
  /** 0 to 100 before weighting. */
  score: number
  /** Weight out of 100. */
  weight: number
  /** Points contributed to the store total. */
  weighted: number
}

export interface MissionScore {
  persona: PersonaId
  label: string
  /** 0 to 100. Did this shopper finish its own job? */
  score: number
}

export interface StoreScore {
  total: number
  categories: CategoryScore[]
  missions: MissionScore[]
  findings: import("./findings.ts").Finding[]
}

export function blankEvidence(storeUrl: string): StoreEvidence {
  return {
    storeUrl,
    http: {
      productsJsonOk: false,
      searchOk: false,
      robotsBlocksAgents: false,
      productJsonLd: false,
      passwordWall: false,
      unreachable: false,
    },
    catalog: { productCount: 0, pricedRatio: 0, imagedRatio: 0, experimentRatio: 0 },
    policies: {
      shippingText: null,
      refundText: null,
      shippingPriceDisclosed: false,
      shippingEtaDisclosed: false,
      refundWindowDays: null,
    },
    checkout: { attempted: false, reached: false, botWall: false },
    missions: [],
  }
}

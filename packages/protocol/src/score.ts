import { FIX_COPY, type Finding, type FindingCode } from "./findings.js"
import {
  PERSONAS,
  type CategoryScore,
  type MissionEvidence,
  type MissionScore,
  type PersonaId,
  type StoreEvidence,
  type StoreScore,
} from "./evidence.js"

const WEIGHTS: Record<CategoryScore["id"], { label: string; weight: number }> = {
  discoverability: { label: "Discoverability", weight: 15 },
  catalog: { label: "Catalog clarity", weight: 15 },
  variantFit: { label: "Variant and spec fit", weight: 20 },
  cart: { label: "Cart", weight: 15 },
  shipping: { label: "Shipping before checkout", weight: 15 },
  policies: { label: "Return policy", weight: 10 },
  checkout: { label: "Checkout reach", weight: 10 },
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function category(id: CategoryScore["id"], score: number): CategoryScore {
  const meta = WEIGHTS[id]
  const rounded = Math.round(Math.min(100, Math.max(0, score)))
  return {
    id,
    label: meta.label,
    score: rounded,
    weight: meta.weight,
    weighted: Math.round((rounded * meta.weight) / 100),
  }
}

function constraintMet(persona: PersonaId, mission: MissionEvidence, evidence: StoreEvidence): boolean {
  const spec = PERSONAS[persona]
  if (!mission.matchedVariant) return false
  if (spec.needsColor && !mission.colorInText) return false
  if (spec.needsSize && !mission.sizeSelectable) return false
  if (spec.needsEta && !evidence.policies.shippingEtaDisclosed) return false
  if (spec.needsReturns && evidence.policies.refundWindowDays == null) return false
  if (spec.maxSteps != null && (mission.abandoned || mission.steps > spec.maxSteps)) return false
  return true
}

export function scoreMission(persona: PersonaId, mission: MissionEvidence, evidence: StoreEvidence): MissionScore {
  const spec = PERSONAS[persona]
  let score = 0
  if (mission.matchedVariant) score += 40
  if (mission.cartAccepted) score += 30
  if (spec.needsColor) score += mission.colorInText ? 30 : 0
  else if (spec.needsSize) score += mission.sizeSelectable ? 30 : 0
  else if (spec.needsEta) score += evidence.policies.shippingEtaDisclosed ? 30 : 0
  else if (spec.needsReturns) score += evidence.policies.refundWindowDays != null ? 30 : 0
  else if (spec.maxSteps != null) score += mission.steps <= spec.maxSteps && !mission.abandoned ? 30 : 0
  else score += 30
  if (mission.abandoned) score = Math.min(score, 40)
  if (spec.needsReturns && evidence.policies.refundWindowDays == null) {
    score = Math.min(score, 40)
  }
  return { persona, label: spec.label, score }
}

function variantFit(evidence: StoreEvidence): number {
  if (evidence.missions.length === 0) return 0
  const hits = evidence.missions.filter((mission) => constraintMet(mission.persona, mission, evidence))
  return (hits.length / evidence.missions.length) * 100
}

function cartFit(evidence: StoreEvidence): number {
  const eligible = evidence.missions.filter((mission) => mission.matchedVariant)
  if (eligible.length === 0) return 0
  const added = eligible.filter((mission) => mission.cartAccepted)
  return (added.length / eligible.length) * 100
}

function shippingFit(evidence: StoreEvidence): number {
  const { shippingText, shippingPriceDisclosed, shippingEtaDisclosed } = evidence.policies
  if (shippingPriceDisclosed && shippingEtaDisclosed) return 100
  if (shippingPriceDisclosed) return 70
  if (shippingText && shippingText.trim().length > 0) return 20
  return 0
}

function policyFit(evidence: StoreEvidence): number {
  let score = 0
  if (evidence.policies.shippingText && evidence.policies.shippingText.trim().length > 0) score += 20
  if (evidence.policies.refundText && evidence.policies.refundText.trim().length > 0) score += 40
  if (evidence.policies.refundWindowDays != null) score += 40
  return score
}

function checkoutFit(evidence: StoreEvidence): number {
  if (!evidence.checkout.attempted) return 0
  if (evidence.checkout.botWall) return 40
  if (evidence.checkout.reached) return 100
  return 0
}

function pushFinding(list: Finding[], code: FindingCode, personas: string[]): void {
  const copy = FIX_COPY[code]
  list.push({ code, severity: copy.severity, summary: copy.summary, fix: copy.fix, personas })
}

function personasWhere(evidence: StoreEvidence, pred: (mission: MissionEvidence) => boolean): string[] {
  return evidence.missions.filter(pred).map((mission) => mission.persona)
}

export function deriveFindings(evidence: StoreEvidence): Finding[] {
  if (evidence.http.unreachable) {
    const findings: Finding[] = []
    pushFinding(findings, "STORE_UNREACHABLE", [])
    return findings
  }
  if (evidence.http.passwordWall) {
    const findings: Finding[] = []
    pushFinding(findings, "STORE_PASSWORD_WALL", [])
    return findings
  }

  const findings: Finding[] = []
  if (!evidence.http.productsJsonOk) pushFinding(findings, "PRODUCTS_JSON_MISSING", [])
  if (!evidence.http.searchOk) pushFinding(findings, "SEARCH_UNUSABLE", ["bargain", "impatient"])
  if (!evidence.http.productJsonLd) pushFinding(findings, "NO_PRODUCT_JSONLD", [])
  if (evidence.http.robotsBlocksAgents) pushFinding(findings, "ROBOTS_BLOCKS_AGENTS", [])
  if (evidence.catalog.pricedRatio < 1) pushFinding(findings, "PRICE_MISSING", [])
  if (evidence.catalog.imagedRatio < 1) pushFinding(findings, "IMAGE_MISSING", [])
  if (clamp01(evidence.catalog.experimentRatio ?? 0) >= 0.2) {
    pushFinding(findings, "EXPERIMENT_TITLES", ["impatient", "bargain"])
  }

  const colorMiss = personasWhere(
    evidence,
    (mission) => PERSONAS[mission.persona].needsColor && !mission.colorInText,
  )
  if (colorMiss.length > 0) pushFinding(findings, "COLOR_NOT_IN_TEXT", colorMiss)

  const sizeMiss = personasWhere(
    evidence,
    (mission) => PERSONAS[mission.persona].needsSize && !mission.sizeSelectable,
  )
  if (sizeMiss.length > 0) pushFinding(findings, "SIZE_OPTION_MISSING", sizeMiss)

  const unmatched = personasWhere(
    evidence,
    (mission) =>
      !mission.matchedVariant &&
      !PERSONAS[mission.persona].needsColor &&
      !PERSONAS[mission.persona].needsSize,
  )
  if (unmatched.length > 0) pushFinding(findings, "VARIANT_SPEC_UNMATCHED", unmatched)

  const cartMiss = personasWhere(
    evidence,
    (mission) => mission.matchedVariant && !mission.cartAccepted && !PERSONAS[mission.persona].needsReturns,
  )
  if (cartMiss.length > 0) pushFinding(findings, "CART_ADD_FAILED", cartMiss)

  if (!evidence.policies.shippingPriceDisclosed) {
    pushFinding(findings, "SHIPPING_HIDDEN_UNTIL_CHECKOUT", ["gift", "bargain"])
  }
  if (!evidence.policies.shippingEtaDisclosed) {
    pushFinding(findings, "SHIPPING_ETA_MISSING", ["gift"])
  }
  if (!evidence.policies.refundText) {
    pushFinding(findings, "RETURNS_POLICY_MISSING", ["returns"])
  } else if (evidence.policies.refundWindowDays == null) {
    pushFinding(findings, "RETURNS_WINDOW_MISSING", ["returns"])
  }

  if (evidence.checkout.attempted && evidence.checkout.botWall) {
    pushFinding(findings, "CHECKOUT_BOT_WALL", ["impatient"])
  } else if (evidence.checkout.attempted && !evidence.checkout.reached) {
    pushFinding(findings, "CHECKOUT_UNREACHABLE", ["impatient"])
  }

  return findings
}

/** Pure store score. Shoppers collect evidence; they do not invent the number. */
export function scoreStore(evidence: StoreEvidence): StoreScore {
  const missions = evidence.missions.map((mission) => scoreMission(mission.persona, mission, evidence))

  if (evidence.http.unreachable || evidence.http.passwordWall) {
    const categories = (Object.keys(WEIGHTS) as CategoryScore["id"][]).map((id) => category(id, 0))
    return { total: 0, categories, missions, findings: deriveFindings(evidence) }
  }

  const discoverability =
    (evidence.http.productsJsonOk ? 45 : 0) +
    (evidence.http.searchOk ? 20 : 0) +
    (evidence.http.productJsonLd ? 20 : 0) +
    (evidence.http.robotsBlocksAgents ? 0 : 15)

  const catalogBase =
    evidence.catalog.productCount === 0
      ? 0
      : clamp01(evidence.catalog.pricedRatio) * 60 + clamp01(evidence.catalog.imagedRatio) * 40
  const catalog = catalogBase * (1 - 0.4 * clamp01(evidence.catalog.experimentRatio ?? 0))

  const categories = [
    category("discoverability", discoverability),
    category("catalog", catalog),
    category("variantFit", variantFit(evidence)),
    category("cart", cartFit(evidence)),
    category("shipping", shippingFit(evidence)),
    category("policies", policyFit(evidence)),
    category("checkout", evidence.checkout.attempted ? checkoutFit(evidence) : 0),
  ]

  const total = categories.reduce((sum, item) => sum + item.weighted, 0)
  return { total, categories, missions, findings: deriveFindings(evidence) }
}

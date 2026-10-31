import {
  blankEvidence,
  PERSONA_IDS,
  ReportJournal,
  type Finding,
  type ReportView,
} from "@readiness/protocol"
import { experimentRatio, SPEC_SIZE } from "./catalog.js"
import { shopPersona } from "./mission.js"
import { disclosesShippingEta, disclosesShippingPrice, refundWindowDays, type StorefrontSnapshot } from "./shopify.js"
import {
  LivePort,
  MemoryPort,
  ADMIN_SCOPES,
  SIZES,
  adminGraphqlFromEnv,
  adminShopHost,
  applyJsonLdLocal,
  applyRefundLocal,
  applyShippingLocal,
  applySizesLocal,
  applyVizLocal,
  attributePairs,
  cloneRead,
  draftVizTitle,
  ghostOf,
  hasSize,
  policyHtml,
  productJsonLd,
  revertDrift,
  seedDefects,
  shouldDryRun,
  vizProducts,
  asShopify,
  type AppliedOp,
  type CatalogProduct,
  type StoreRead,
} from "./admin.js"
import { draftPolicy, type PolicyDraft } from "./policy-draft.js"

export { ADMIN_SCOPES, shouldDryRun, seedDefects }

export interface FindingInput {
  code: string
  summary: string
}

export interface RelayMessageInput {
  channel: string
  text: string
}

export interface FixProposal {
  id: string
  kind: "offer" | "shipping_policy" | "refund_policy" | "ghost_size" | "viz_catalog" | "jsonld_hint"
  card: "offer" | "shipping" | "attributes" | "catalog"
  title: string
  before: string
  after: string
  summary: string
  findingCodes: string[]
  source: "store" | "openai" | "fallback"
  approved: boolean
  writes: boolean
  status: "proposed" | "applied" | "skipped" | "failed" | "reverted"
  error: string | null
}

export interface FixerView {
  sessionId: string
  storeUrl: string
  shop: string
  dryRun: boolean
  phase: "draft" | "applied" | "reverted"
  steps: { id: string; label: string }[]
  proposals: FixProposal[]
  floor: string[]
  scoreBefore: number
  scoreAfter: number | null
  findings: { code: string; summary: string }[]
  product: { title: string; handle: string; price: string } | null
  error: string | null
  canRevert: boolean
  /** True when Apply will call the Admin API. False only when the token is missing. */
  writesToShopify: boolean
}

export interface FixerBlob {
  v: 1
  sessionId: string
  storeUrl: string
  shop: string
  dryRun: boolean
  baseline: StoreRead
  working: StoreRead
  proposals: FixProposal[]
  appliedOps: AppliedOp[]
  phase: FixerView["phase"]
  floor: string[]
  scoreBefore: number
  scoreAfter: number | null
  findings: FixerView["findings"]
  findingsBefore: FixerView["findings"]
  error: string | null
  steps: FixerView["steps"]
}

type Port = LivePort | MemoryPort

function listedPrice(price: string): string {
  const amount = Number(price)
  if (!Number.isFinite(amount)) return price
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`
}

export function collectFindings(input: { findings?: FindingInput[]; relayMessages?: RelayMessageInput[] }): FindingInput[] {
  const list = [...(input.findings ?? [])]
  for (const message of input.relayMessages ?? []) {
    if (message.channel !== "findings") continue
    try {
      const parsed = JSON.parse(message.text) as { code?: unknown; summary?: unknown }
      if (typeof parsed.code === "string") {
        list.push({ code: parsed.code, summary: typeof parsed.summary === "string" ? parsed.summary : "" })
      }
    } catch {
      // Floor text and other non-JSON lines are not findings.
    }
  }
  return list
}

function codesFor(findings: FindingInput[], codes: string[]): string[] {
  return [...new Set(findings.filter((finding) => codes.includes(finding.code)).map((finding) => finding.code))]
}

function proposal(partial: Omit<FixProposal, "approved" | "status" | "error">): FixProposal {
  return { ...partial, approved: true, status: "proposed", error: null }
}

function plan(read: StoreRead, findings: FindingInput[], shipping: PolicyDraft, refund: PolicyDraft): FixProposal[] {
  const ghost = ghostOf(read)
  const proposals: FixProposal[] = []
  if (ghost) {
    const price = ghost.variants[0]?.price ?? "0.00"
    proposals.push(
      proposal({
        id: "offer",
        kind: "offer",
        card: "offer",
        title: "Listed price",
        before: price,
        after: price,
        summary: "The variant price stays. Apply does not discount it.",
        findingCodes: [],
        source: "store",
        writes: false,
      }),
    )
  }
  const shippingText = read.shippingText ?? ""
  if (!disclosesShippingPrice(shippingText) || !disclosesShippingEta(shippingText)) {
    proposals.push(
      proposal({
        id: "shipping",
        kind: "shipping_policy",
        card: "shipping",
        title: "Shipping policy",
        before: read.shippingText ?? "No shipping policy",
        after: shipping.text,
        summary: "State a price and a delivery window in days.",
        findingCodes: codesFor(findings, ["SHIPPING_HIDDEN_UNTIL_CHECKOUT", "SHIPPING_ETA_MISSING"]),
        source: shipping.source,
        writes: true,
      }),
    )
  }
  if (!read.refundText || refundWindowDays(read.refundText) == null) {
    proposals.push(
      proposal({
        id: "refund",
        kind: "refund_policy",
        card: "shipping",
        title: "Refund policy",
        before: read.refundText ?? "No refund policy",
        after: refund.text,
        summary: "Publish a return window in days.",
        findingCodes: codesFor(findings, ["RETURNS_POLICY_MISSING", "RETURNS_WINDOW_MISSING"]),
        source: refund.source,
        writes: true,
      }),
    )
  }
  if (ghost && !hasSize(ghost, SPEC_SIZE)) {
    proposals.push(
      proposal({
        id: "size",
        kind: "ghost_size",
        card: "attributes",
        title: "Size option",
        before: ghost.options.map((option) => `${option.name}: ${option.values.join(", ")}`).join(" · ") || "No options",
        after: `Size ${SIZES.join(", ")}`,
        summary: `Add Size ${SIZES.join(", ")} on ${ghost.title}, including ${SPEC_SIZE}.`,
        findingCodes: codesFor(findings, ["SIZE_OPTION_MISSING", "VARIANT_SPEC_UNMATCHED"]),
        source: "store",
        writes: true,
      }),
    )
  }
  if (ghost && !ghost.jsonLd) {
    const pairs = attributePairs({ title: ghost.title, price: ghost.variants[0]?.price ?? "0.00" })
    proposals.push(
      proposal({
        id: "jsonld",
        kind: "jsonld_hint",
        card: "attributes",
        title: "Product JSON-LD hint",
        before: "No Product JSON-LD metafield",
        after: pairs.map((pair) => `${pair.key}: ${JSON.stringify(pair.value)}`).join("\n"),
        summary: "Write schema.org Product JSON to the agent_readiness.jsonld metafield. The theme must print it before the storefront audit sees it.",
        findingCodes: codesFor(findings, ["NO_PRODUCT_JSONLD"]),
        source: "store",
        writes: true,
      }),
    )
  }
  const experiments = vizProducts(read).filter((product) => product.status === "ACTIVE")
  if (experiments.length > 0) {
    const sample = experiments[0]!
    proposals.push(
      proposal({
        id: "viz",
        kind: "viz_catalog",
        card: "catalog",
        title: "Experiment titles",
        before: `${experiments.length} active titles start with VIZ. ${sample.title}`,
        after: `Unpublish and retitle. ${sample.title} → ${draftVizTitle(sample.title)}`,
        summary: "Set each VIZ product to draft and drop the experiment prefix so it leaves the Online Store.",
        findingCodes: codesFor(findings, ["EXPERIMENT_TITLES"]),
        source: "store",
        writes: true,
      }),
    )
  }
  return proposals
}

export function snapshotFromRead(read: StoreRead, storeUrl: string): StorefrontSnapshot {
  const products = read.products.filter((product) => product.status === "ACTIVE").map(asShopify)
  const shipping = read.shippingText
  const refund = read.refundText
  const evidence = blankEvidence(storeUrl)
  evidence.http = {
    productsJsonOk: products.length > 0,
    searchOk: true,
    robotsBlocksAgents: false,
    // The metafield is a hint. The audit only counts JSON-LD that is in the HTML.
    productJsonLd: false,
    passwordWall: false,
    unreachable: false,
  }
  const priced = products.filter((product) => product.variants.every((variant: { price: string }) => Number(variant.price) > 0)).length
  const imaged = products.filter((product) => product.images.length > 0).length
  evidence.catalog = {
    productCount: products.length,
    pricedRatio: products.length ? priced / products.length : 0,
    imagedRatio: products.length ? imaged / products.length : 0,
    experimentRatio: experimentRatio(products),
  }
  evidence.policies = {
    shippingText: shipping,
    refundText: refund,
    shippingPriceDisclosed: shipping ? disclosesShippingPrice(shipping) : false,
    shippingEtaDisclosed: shipping ? disclosesShippingEta(shipping) : false,
    refundWindowDays: refund ? refundWindowDays(refund) : null,
  }
  evidence.checkout = { attempted: true, reached: true, botWall: false }
  return { origin: `https://${read.shop}`, products, evidence }
}

export async function scoreRead(read: StoreRead, storeUrl: string): Promise<ReportView> {
  const snapshot = snapshotFromRead(read, storeUrl)
  const journal = new ReportJournal()
  await journal.open("fixer", snapshot.evidence)
  for (const persona of PERSONA_IDS) {
    const outcome = await shopPersona({ persona, snapshot, liveCart: false, useModel: false })
    await journal.submitMission(outcome.mission)
  }
  return journal.finalize()
}

function findingLines(findings: Finding[]): { code: string; summary: string }[] {
  return findings.map((finding) => ({ code: finding.code, summary: finding.summary }))
}

/**
 * Propose, apply, and revert. The baseline captured at open() is what Revert writes back.
 * Apply calls Shopify unless the port is the no-token memory port.
 */
export class FixerEngine {
  private constructor(
    private blob: FixerBlob,
    private port: Port,
  ) {}

  static async open(input: {
    storeUrl?: string
    findings?: FindingInput[]
    relayMessages?: RelayMessageInput[]
    /** Tests inject a port. Production uses the token, or the memory port when it is missing. */
    port?: Port
    env?: Record<string, string | undefined>
    sessionId?: string
  }): Promise<FixerEngine> {
    const env = input.env ?? (globalThis as any).process.env
    const storeUrl = (input.storeUrl?.trim() || env.SHOP_URL || "https://aiconvertit-demo.myshopify.com").replace(/\/$/, "")
    const shop = adminShopHost(storeUrl)
    const dryRun = input.port ? input.port.dryRun : shouldDryRun(env)
    const port = input.port ?? (dryRun ? new MemoryPort(shop) : new LivePort(adminGraphqlFromEnv(shop, env), shop))
    const read = await port.read()
    const findings = collectFindings(input)
    const ghost = ghostOf(read)
    const shippingBroken = !disclosesShippingPrice(read.shippingText ?? "") || !disclosesShippingEta(read.shippingText ?? "")
    const refundBroken = !read.refundText || refundWindowDays(read.refundText) == null
    const [shipping, refund] = await Promise.all([
      shippingBroken ? draftPolicy("shipping", read.shippingText, { env }) : Promise.resolve({ text: read.shippingText ?? "", source: "fallback" as const }),
      refundBroken ? draftPolicy("refund", read.refundText, { env }) : Promise.resolve({ text: read.refundText ?? "", source: "fallback" as const }),
    ])
    const priced = ghost?.variants[0]?.price ?? "0.00"
    const scored = await scoreRead(read, storeUrl)
    const blob: FixerBlob = {
      v: 1,
      sessionId: input.sessionId ?? crypto.randomUUID().slice(0, 8),
      storeUrl,
      shop,
      dryRun,
      baseline: cloneRead(read),
      working: cloneRead(read),
      proposals: plan(read, findings, shipping, refund),
      appliedOps: [],
      phase: "draft",
      floor: [
        dryRun
          ? "fixer: No SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET. This session is a dry run and will not write to Shopify."
          : `fixer: Read ${shop}. Apply writes to the Shopify admin. Revert restores this snapshot.`,
      ],
      scoreBefore: scored.total,
      scoreAfter: null,
      findings: findingLines(scored.findings),
      findingsBefore: findingLines(scored.findings),
      error: null,
      steps: [
        { id: "price", label: `Reading the listed ${listedPrice(priced)} price.` },
        { id: "specs", label: "Reading existing product specifications." },
        { id: "attrs", label: "Making the attributes explicit and consistent." },
      ],
    }
    return new FixerEngine(blob, port)
  }

  static hydrate(blob: FixerBlob, env: Record<string, string | undefined> = (globalThis as any).process.env): FixerEngine {
    const port = blob.dryRun ? new MemoryPort(blob.shop) : new LivePort(adminGraphqlFromEnv(blob.shop, env), blob.shop)
    return new FixerEngine(structuredClone(blob), port)
  }

  serialize(): FixerBlob {
    return structuredClone(this.blob)
  }

  view(): FixerView {
    const ghost = ghostOf(this.blob.working) ?? ghostOf(this.blob.baseline)
    return {
      sessionId: this.blob.sessionId,
      storeUrl: this.blob.storeUrl,
      shop: this.blob.shop,
      dryRun: this.blob.dryRun,
      phase: this.blob.phase,
      steps: this.blob.steps,
      proposals: this.blob.proposals,
      floor: this.blob.floor,
      scoreBefore: this.blob.scoreBefore,
      scoreAfter: this.blob.scoreAfter,
      findings: this.blob.findings,
      product: ghost
        ? { title: ghost.title, handle: ghost.handle, price: ghost.variants[0]?.price ?? "0.00" }
        : null,
      error: this.blob.error,
      canRevert: this.blob.appliedOps.length > 0,
      writesToShopify: !this.blob.dryRun,
    }
  }

  approve(id: string, approved: boolean): FixerView {
    const proposal = this.blob.proposals.find((item) => item.id === id)
    if (!proposal) throw new Error(`Unknown change ${id}`)
    if (!proposal.writes) return this.view()
    if (proposal.status === "applied") throw new Error("That change is already written. Revert the store before changing the selection.")
    proposal.approved = approved
    return this.view()
  }

  async apply(): Promise<FixerView> {
    this.blob.error = null
    const chosen = this.blob.proposals.filter((item) => item.writes && item.approved && item.status !== "applied")
    for (const item of this.blob.proposals) {
      if (item.writes && !item.approved && item.status === "proposed") item.status = "skipped"
    }
    for (const item of chosen) {
      try {
        await this.applyOne(item)
        item.status = "applied"
        item.error = null
      } catch (error) {
        item.status = "failed"
        item.error = error instanceof Error ? error.message : String(error)
        this.blob.error = item.error
        this.blob.floor.push(`fixer: ${item.title} failed. ${item.error}`)
      }
    }
    if (this.blob.appliedOps.length > 0) {
      this.blob.phase = "applied"
      await this.rememberScore(this.blob.working)
    }
    return this.view()
  }

  async revert(): Promise<FixerView> {
    if (this.blob.appliedOps.length === 0) {
      this.blob.error = "Nothing has been written yet."
      return this.view()
    }
    const ops = [...this.blob.appliedOps]
    try {
      await this.port.restore(this.blob.baseline, ops)
      if (!this.port.dryRun) {
        const seen = await this.port.read()
        const drift = revertDrift(this.blob.baseline, seen, ops)
        if (drift.length > 0) {
          this.blob.error = `Revert did not stick (${drift.join(", ")}). The snapshot is still held. Try Revert store again.`
          this.blob.floor.push(`fixer: Revert did not match the snapshot (${drift.join(", ")}).`)
          return this.view()
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.blob.error = `Revert failed: ${message}. The snapshot is still held.`
      this.blob.floor.push(`fixer: Revert failed. ${message}`)
      return this.view()
    }
    this.blob.working = cloneRead(this.blob.baseline)
    this.blob.appliedOps = []
    this.blob.phase = "reverted"
    this.blob.scoreAfter = null
    this.blob.findings = this.blob.findingsBefore.map((finding) => ({ ...finding }))
    for (const item of this.blob.proposals) {
      if (!item.writes) continue
      item.status = "proposed"
      item.error = null
    }
    this.blob.error = null
    this.blob.floor.push("fixer: Reverted the store to the snapshot taken before the first write.")
    return this.view()
  }

  /** Shoppers score the catalog again. Live sessions re-read the Admin API first. */
  async rerun(): Promise<FixerView> {
    if (!this.port.dryRun) {
      const seen = await this.port.read()
      this.blob.working = cloneRead(seen)
      await this.rememberScore(seen)
      this.blob.floor.push(`fixer: Shoppers reran on the Admin catalog. Score ${this.blob.scoreBefore} → ${this.blob.scoreAfter}.`)
      return this.view()
    }
    await this.rememberScore(this.blob.working)
    this.blob.floor.push(`fixer: Shoppers reran on the dry-run catalog. Score ${this.blob.scoreBefore} → ${this.blob.scoreAfter}.`)
    return this.view()
  }

  private async rememberScore(read: StoreRead): Promise<void> {
    const scored = await scoreRead(read, this.blob.storeUrl)
    this.blob.scoreAfter = scored.total
    this.blob.findings = findingLines(scored.findings)
  }

  private async applyOne(item: FixProposal): Promise<void> {
    if (item.kind === "shipping_policy") {
      const html = policyHtml(item.after)
      await this.port.writePolicy("SHIPPING_POLICY", html)
      applyShippingLocal(this.blob.working, html, item.after)
      this.blob.appliedOps.push({ kind: "shipping" })
      this.blob.floor.push(`fixer: Shipping policy now states a price and a delivery window.`)
      return
    }
    if (item.kind === "refund_policy") {
      const html = policyHtml(item.after)
      await this.port.writePolicy("REFUND_POLICY", html)
      applyRefundLocal(this.blob.working, html, item.after)
      this.blob.appliedOps.push({ kind: "refund" })
      this.blob.floor.push("fixer: Refund policy now states a return window in days.")
      return
    }
    if (item.kind === "ghost_size") {
      const ghost = ghostOf(this.blob.working)
      if (!ghost) throw new Error("Ghost 18 is not in the catalog")
      await this.port.addSizes(ghost, SIZES)
      applySizesLocal(this.blob.working, ghost.id, SIZES)
      this.blob.appliedOps.push({ kind: "sizes", productId: ghost.id })
      this.blob.floor.push(`fixer: ${ghost.title} now has a Size option (${SIZES.join(", ")}).`)
      return
    }
    if (item.kind === "viz_catalog") {
      const rows = vizProducts(this.blob.working).filter((product) => product.status === "ACTIVE")
      if (rows.length === 0) return
      for (const product of rows) {
        const title = draftVizTitle(product.title)
        await this.port.updateProduct(product.id, { title, status: "DRAFT" })
        applyVizLocal(this.blob.working, product.id, title)
        this.blob.appliedOps.push({ kind: "viz", productId: product.id })
      }
      this.blob.floor.push(`fixer: Unpublished ${rows.length} VIZ titles and removed the experiment prefix.`)
      return
    }
    if (item.kind === "jsonld_hint") {
      const ghost = ghostOf(this.blob.working)
      if (!ghost) throw new Error("Ghost 18 is not in the catalog")
      const json = productJsonLd({ title: ghost.title, price: ghost.variants[0]?.price ?? "0.00" })
      await this.port.setJsonLd(ghost.id, json)
      applyJsonLdLocal(this.blob.working, ghost.id, json)
      this.blob.appliedOps.push({ kind: "jsonld", productId: ghost.id })
      this.blob.floor.push("fixer: Wrote a Product JSON-LD hint on Ghost 18 (metafield agent_readiness.jsonld). The theme still has to print it.")
    }
  }
}

export type { CatalogProduct, StoreRead }

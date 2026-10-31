"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import type { FixerView, FixProposal } from "@readiness/shop"

const TEAL = "#1F7A6A"

function money(price: string, cents: boolean): string {
  const amount = Number(price)
  if (!Number.isFinite(amount)) return price
  if (!cents && Number.isInteger(amount)) return `$${amount}`
  return `$${amount.toFixed(2)}`
}

function Check({ on }: { on: boolean }) {
  return (
    <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
      {on ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none">
          <path d="M3.5 8.2 6.4 11.2 12.5 4.8" stroke={TEAL} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="size-1.5 rounded-full bg-[#D6D5D0]" />
      )}
    </span>
  )
}

function Shoe() {
  return (
    <svg viewBox="0 0 320 150" className="h-44 w-full" aria-hidden>
      <path
        d="M38 96c18-2 46-8 78-10 28-2 62 2 92 8 22 4 48 2 70-10 10-6 18-16 16-26-2-8-12-12-24-8-14 4-22 2-34-8-16-14-42-22-68-16-18 4-34 8-62 18-20 8-36 14-48 22-10 6-22 16-20 30z"
        fill="#1A1A1A"
      />
      <path d="M34 108h250c10 0 16 6 12 12H46c-12 0-18-6-12-12z" fill="#111" />
      <path d="M120 78c14-10 34-16 52-12M146 70c8 8 10 16 6 24M168 66c10 8 14 18 8 28" stroke="#3A3A3A" strokeWidth="2" fill="none" />
    </svg>
  )
}

async function post(body: Record<string, unknown>): Promise<FixerView> {
  const response = await fetch("/api/fixer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as FixerView & { error?: string }
  if (!response.ok || payload.error) throw new Error(payload.error || "The fixer failed.")
  return payload
}

function proposal(view: FixerView, id: string): FixProposal | undefined {
  return view.proposals.find((item) => item.id === id)
}

function active(view: FixerView, id: string): boolean {
  const item = proposal(view, id)
  if (!item || !item.writes) return false
  if (view.phase === "applied") return item.status === "applied"
  return item.approved && item.status !== "failed"
}

export function FixerBoard() {
  const [view, setView] = useState<FixerView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seen, setSeen] = useState(0)
  const [pane, setPane] = useState<"draft" | "page">("draft")
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void post({ action: "open" })
      .then((next) => {
        setView(next)
        let step = 0
        const timer = window.setInterval(() => {
          step += 1
          setSeen(step)
          if (step >= 3) window.clearInterval(timer)
        }, 450)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The fixer failed."))
  }, [])

  async function run(body: Record<string, unknown>, after?: "page" | "draft") {
    setBusy(true)
    setError(null)
    try {
      const next = await post(body)
      setView(next)
      if (after) setPane(after)
      if (next.error) setError(next.error)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The fixer failed.")
    } finally {
      setBusy(false)
    }
  }

  const applied = view?.phase === "applied"
  const dry = view?.dryRun !== false
  const price = view?.product?.price ?? "152.00"
  const handle = view?.product?.handle ?? "brooks-mens-ghost-18-running-shoes"
  const shop = view?.shop ?? "aiconvertit-demo.myshopify.com"
  const caption = applied
    ? "A stronger offer. The details in plain sight."
    : seen < 2
      ? "First, make the offer more competitive."
      : "Make the product attributes explicit and consistent."

  const shipping = view ? proposal(view, "shipping") : undefined
  const refund = view ? proposal(view, "refund") : undefined
  const size = view ? proposal(view, "size") : undefined
  const jsonld = view ? proposal(view, "jsonld") : undefined
  const viz = view ? proposal(view, "viz") : undefined
  const showPage = pane === "page" || applied
  const lines = [
    shipping && active(view!, "shipping") ? shipping.after : null,
    refund && active(view!, "refund") ? refund.after : null,
  ].filter((line): line is string => Boolean(line))

  return (
    <main className="min-h-screen bg-[#F7F7F4] px-6 py-8 text-[#26251E]">
      <div className="mx-auto w-full max-w-[1120px]">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <a href="/" className="text-[22px] font-semibold tracking-[-0.04em]">
              tiebreaks.
            </a>
            <a href="/" className="text-[13px] text-[#8A8984] hover:text-[#26251E]">Audit your store</a>
            <a href="/fix" aria-current="page" className="text-[13px] text-[#26251E]">Fix with agent</a>
          </div>
          <span className="rounded-full border border-[#E6E5E0] px-3 py-1 text-[11px] tracking-[0.08em] text-[#8A8984]">
            {dry ? "DRY RUN · NO CREDENTIALS" : "SHOPIFY ADMIN"}
          </span>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="flex min-h-[520px] flex-col rounded-2xl border border-[#E6E5E0] bg-white p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-[#F3F2EE] text-[#1F7A6A]">
              {applied ? <Check on /> : <span className="text-[18px]">✦</span>}
            </div>
            <h2 className="text-[22px] tracking-[-0.03em]">{applied ? "Ready to test again." : "Store agent"}</h2>
            <p className="mt-1 text-[13px] text-[#8A8984]">
              {dry ? "No admin credentials · dry run will not write" : "Editing the Shopify admin catalog"}
            </p>
            <div className="mt-5 rounded-lg bg-[#F3F2EE] px-3 py-3 text-[14px] leading-snug text-[#3F3E38]">
              {applied
                ? "The offer is stronger. The details are easier to compare."
                : "Improve the offer, make the policies easy to find, and clarify the product data."}
            </div>
            <ul className="mt-5 space-y-3 text-[14px]">
              {applied
                ? view?.proposals
                    .filter((item) => item.status === "applied")
                    .map((item) => (
                      <li key={item.id} className="flex gap-2">
                        <Check on />
                        <span>{item.title}</span>
                      </li>
                    ))
                : (view?.steps ?? [{ id: "wait", label: "Reading the store." }]).map((step, index) => (
                    <li key={step.id} className="flex gap-2">
                      <Check on={index < seen} />
                      <span className={index < seen ? "" : "text-[#8A8984]"}>{step.label}</span>
                    </li>
                  ))}
            </ul>
            <div className="mt-auto pt-8 text-[13px]">
              <p className="flex items-center gap-2" style={{ color: TEAL }}>
                <span className="inline-block size-1.5 rounded-full" style={{ background: TEAL }} />
                {applied
                  ? dry
                    ? "Dry run · the store was not written"
                    : "Applied to Shopify"
                  : "Staged edit · no live store changes"}
              </p>
              {view?.canRevert ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run({ action: "revert", sessionId: view.sessionId }, "draft")}
                  className="mt-3 text-left underline decoration-[#E6E5E0] underline-offset-4"
                  style={{ color: TEAL }}
                >
                  Revert store
                </button>
              ) : null}
              {applied && view ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run({ action: "rerun", sessionId: view.sessionId })}
                  className="mt-2 block text-left text-[#26251E] underline decoration-[#E6E5E0] underline-offset-4"
                >
                  Run shoppers again
                </button>
              ) : null}
            </div>
          </aside>

          <section>
            <div className="overflow-hidden rounded-2xl border border-[#E6E5E0] bg-white">
              <p className="border-b border-[#E6E5E0] bg-[#F3F2EE] px-4 py-2 text-center font-mono text-[12px] text-[#8A8984]">
                {shop} / products / {handle}
              </p>
              {showPage ? (
                <ProductPage
                  title={view?.product?.title ?? "Ghost 18"}
                  price={price}
                  lines={lines}
                  sizes={size ? active(view!, "size") : true}
                  attributes={jsonld && active(view!, "jsonld") ? jsonld.after : null}
                  dry={dry}
                  applied={Boolean(applied)}
                />
              ) : (
                <div className="px-6 py-6">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <h3 className="text-[26px] tracking-[-0.03em]">Improve your product page</h3>
                    <span className="rounded-full bg-[#E7EEF2] px-2.5 py-1 text-[12px] text-[#5C6B73]">Draft changes</span>
                  </div>
                  <div className="space-y-3">
                    <Field label="Offer / USD">
                      <p className="text-[32px] tracking-[-0.03em]">{money(price, true)}</p>
                      <p className="mt-1 text-[13px] text-[#8A8984]">Listed price. Apply does not change it.</p>
                    </Field>
                    {shipping || refund ? (
                      <Field label="Shipping & returns / Placement">
                        {shipping ? <ChangeRow item={shipping} busy={busy} onToggle={(approved) => void run({ action: "approve", sessionId: view!.sessionId, proposalId: shipping.id, approved })} /> : null}
                        {refund ? <ChangeRow item={refund} busy={busy} onToggle={(approved) => void run({ action: "approve", sessionId: view!.sessionId, proposalId: refund.id, approved })} /> : null}
                      </Field>
                    ) : null}
                    {size || jsonld ? (
                      <Field label="Product attributes / Explicit fields">
                        {jsonld ? (
                          <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-[#1F7A6A]">{jsonld.after}</pre>
                        ) : null}
                        {size ? <ChangeRow item={size} busy={busy} onToggle={(approved) => void run({ action: "approve", sessionId: view!.sessionId, proposalId: size.id, approved })} /> : null}
                        {jsonld ? <ChangeRow item={jsonld} busy={busy} onToggle={(approved) => void run({ action: "approve", sessionId: view!.sessionId, proposalId: jsonld.id, approved })} /> : null}
                      </Field>
                    ) : null}
                    {viz ? (
                      <Field label="Catalog / Experiment titles">
                        <ChangeRow item={viz} busy={busy} onToggle={(approved) => void run({ action: "approve", sessionId: view!.sessionId, proposalId: viz.id, approved })} />
                      </Field>
                    ) : null}
                  </div>
                  {error ? <p className="mt-4 text-[14px] text-[#9A3412]">{error}</p> : null}
                  <div className="mt-6 flex items-end justify-between gap-4">
                    <button type="button" onClick={() => setPane("page")} className="text-[13px] text-[#8A8984] underline decoration-[#E6E5E0] underline-offset-4">
                      Preview page
                    </button>
                    <button
                      type="button"
                      disabled={busy || !view || !view.proposals.some((item) => item.writes && item.approved && item.status !== "applied")}
                      onClick={() => view && void run({ action: "apply", sessionId: view.sessionId }, "page")}
                      className="h-11 rounded-lg bg-[#26251E] px-5 text-[14px] text-[#F7F7F4] disabled:opacity-40"
                    >
                      {busy ? "Applying…" : dry ? "Apply dry run" : "Apply"}
                    </button>
                  </div>
                  <p className="mt-3 text-right text-[12px] text-[#8A8984]">
                    {dry ? "Dry run. Nothing is sent to Shopify." : "Writes the included changes to Shopify."}
                  </p>
                </div>
              )}
            </div>
            {showPage && !applied ? (
              <div className="mt-3 flex justify-between text-[13px]">
                <button type="button" onClick={() => setPane("draft")} className="text-[#8A8984] underline decoration-[#E6E5E0] underline-offset-4">
                  Back to draft
                </button>
                <button
                  type="button"
                  disabled={busy || !view}
                  onClick={() => view && void run({ action: "apply", sessionId: view.sessionId }, "page")}
                  className="h-11 rounded-lg bg-[#26251E] px-5 text-[14px] text-[#F7F7F4] disabled:opacity-40"
                >
                  {busy ? "Applying…" : dry ? "Apply dry run" : "Apply"}
                </button>
              </div>
            ) : null}
            <p className="mt-8 text-center text-[16px] text-[#3F3E38]">{view ? caption : "Reading the store."}</p>
          </section>
        </div>

        <section className="mt-16 grid gap-12 md:grid-cols-2">
          <div>
            <h3 className="text-[18px] tracking-[-0.02em]">Why zappos.com won</h3>
            <ul className="mt-4 border-t border-[#E6E5E0] text-[14px] text-[#3F3E38]">
              {[
                "Shipping price and a delivery window are on the page.",
                "The return window is a number of days.",
                "Size is a selectable field, including 10.",
                "The product title is the shoe, not an experiment id.",
              ].map((line) => (
                <li key={line} className="border-b border-[#E6E5E0] py-3">
                  {line}
                </li>
              ))}
            </ul>
            {view ? (
              <p className="mt-3 font-mono text-[12px] text-[#8A8984]">
                Score {view.scoreBefore}
                {view.scoreAfter != null ? ` → ${view.scoreAfter}` : ""}
              </p>
            ) : null}
          </div>
          <div>
            <h3 className="text-[18px] tracking-[-0.02em]">Missing on your page</h3>
            <ul className="mt-4 border-t border-[#E6E5E0] text-[14px] text-[#8A8984]">
              {(view?.findings.length ? view.findings : [{ code: "wait", summary: "Findings appear after the read." }]).map((finding) => (
                <li key={finding.code} className="border-b border-[#E6E5E0] py-3">
                  {finding.summary}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-12">
          <h3 className="text-[13px] text-[#8A8984]">#floor</h3>
          <div className="mt-2 max-h-40 overflow-y-auto font-mono text-[12px] leading-relaxed text-[#3F3E38]">
            {(view?.floor ?? []).map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E6E5E0] px-4 py-3">
      <p className="mb-2 text-[11px] tracking-[0.08em] text-[#8A8984] uppercase">{label}</p>
      {children}
    </div>
  )
}

function ChangeRow({ item, busy, onToggle }: { item: FixProposal; busy: boolean; onToggle: (approved: boolean) => void }) {
  return (
    <div className="mt-3 border-t border-[#E6E5E0] pt-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[12px] text-[#8A8984]">
          {item.title}
          {item.source === "openai" ? " · drafted with OpenAI" : item.source === "fallback" ? " · fallback copy" : ""}
          {item.status === "failed" ? ` · ${item.error}` : ""}
        </p>
        <label className="flex items-center gap-2 text-[12px] text-[#3F3E38]">
          <input
            type="checkbox"
            className="accent-[#1F7A6A]"
            checked={item.approved}
            disabled={busy || item.status === "applied"}
            onChange={(event) => onToggle(event.target.checked)}
          />
          Include
        </label>
      </div>
      <p className="text-[13px] text-[#B5B4AE] line-through">{item.before}</p>
      <p className="mt-1 text-[14px]">{item.after}</p>
    </div>
  )
}

function ProductPage({
  title,
  price,
  lines,
  sizes,
  attributes,
  dry,
  applied,
}: {
  title: string
  price: string
  lines: string[]
  sizes: boolean
  attributes: string | null
  dry: boolean
  applied: boolean
}) {
  const chips = ["8", "9", "10", "11", "12"]
  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex items-center justify-between text-[12px] tracking-[0.12em] text-[#8A8984]">
        <span>AICONVERTIT DEMO</span>
        <span>RUNNING / SHOP</span>
      </div>
      <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
        <div className="flex items-center rounded-xl bg-[#F4F1EA] px-4">
          <Shoe />
        </div>
        <div>
          <p className="text-[12px] tracking-[0.08em] text-[#8A8984]">BROOKS / MEN&apos;S ROAD RUNNING</p>
          <h3 className="mt-2 text-[32px] tracking-[-0.03em]">{title.replace(/^Brooks Men's /, "")}</h3>
          <p className="mt-1 text-[14px] text-[#8A8984]">Neutral support. Everyday miles.</p>
          <p className="mt-4 text-[28px] tracking-[-0.03em]">{money(price, false)}</p>
          {sizes ? (
            <div className="mt-4 flex gap-2">
              {chips.map((size) => (
                <span
                  key={size}
                  className={`grid size-9 place-items-center rounded-md border text-[13px] ${size === "10" ? "border-[#26251E]" : "border-[#E6E5E0] text-[#8A8984]"}`}
                >
                  {size}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-4 grid h-11 place-items-center rounded-md bg-[#1C3A2A] text-[14px] text-white">Add to bag</div>
          <ul className="mt-4 space-y-1.5 text-[13px]">
            {lines.map((line) => (
              <li key={line} className="flex gap-2">
                <Check on />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {attributes ? <pre className="mt-6 whitespace-pre-wrap font-mono text-[12px] text-[#8A8984]">{attributes}</pre> : null}
      <p className="mt-4 border-t border-[#E6E5E0] pt-3 text-[13px] text-[#8A8984]">
        {applied
          ? dry
            ? "Dry run only. Shopify was not modified. Revert store restores the local snapshot."
            : "Written to Shopify. Revert store restores the snapshot taken before the first write."
          : "Preview only. Nothing has been written."}
      </p>
    </div>
  )
}

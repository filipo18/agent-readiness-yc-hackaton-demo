"use client"

import { useEffect, useRef, useState } from "react"
import { PERSONAS, PERSONA_IDS, type PersonaId, type ReportView, type ShopperView } from "@readiness/protocol"

interface RelayMessage {
  id: string
  channel: "floor" | "findings"
  from: string
  text: string
  at?: string
}

interface Config {
  shopUrl: string
  passwordSet: boolean
  openai: boolean
  relay: boolean
}

function idleShoppers(): ShopperView[] {
  return PERSONA_IDS.map((persona) => ({
    persona,
    status: "idle",
    goal: PERSONAS[persona].goal,
    step: "Waiting for a run",
    stepsDone: 0,
    cartVariantId: null,
    missionScore: null,
    blockerCodes: [],
  }))
}

const DOT: Record<string, string> = {
  idle: "bg-[#D6D5D0]",
  running: "bg-[#F54E00]",
  done: "bg-[#26251E]",
  blocked: "bg-[#8A8984]",
  error: "bg-[#8A8984]",
}

function relTime(at: string | undefined, start: number | null): string {
  if (!at || start == null) return "+0.0s"
  const ms = Math.max(0, new Date(at).getTime() - start)
  return `+${(ms / 1000).toFixed(1)}s`
}

/** Mono-wrap URLs, codes, and long numeric ids inside feed text. */
function LogText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+|\/[a-z][\w./-]*\.json|\b[A-Z][A-Z_]{4,}\b|\b\d{6,}\b)/g)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="font-mono text-[12px] text-[#26251E]">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[11px] uppercase tracking-[0.08em] text-[#8A8984]">{children}</p>
}


const PLAIN_PERSONA: Record<string, { name: string; intent: string }> = {
  bargain: { name: "Bargain hunter", intent: "Wants the cheapest Brooks Ghost 18 in the store." },
  gift: { name: "Gift buyer", intent: "Needs a pair of Ghost 18s delivered by Friday." },
  spec: { name: "Size 10 runner", intent: "Wants the Ghost 18 in men's size 10, nothing else." },
  impatient: { name: "Impatient buyer", intent: "Will buy anything in stock, but only in 4 clicks or fewer." },
  returns: { name: "Returns checker", intent: "Only buys if the store says how many days you have to return it." },
}

const PLAIN_ISSUE: Record<string, { title: string; short: string; fix: string; why?: string }> = {
  EXPERIMENT_TITLES: { title: "Product names look like test labels (VIZ V…)", short: "names looked like test labels", fix: "Give each shoe one real name, like ‘Brooks Ghost 18’, and hide the test copies.", why: "Agents rank clearly named products about 3 places higher." },
  LISTING_DETAIL_THIN: { title: "Product descriptions are too short", short: "description too thin", fix: "Add fit, use, materials, drop and weight to the description.", why: "Missing details were the reason agents skipped an offer about 30% of the time." },
  SIZE_OPTION_MISSING: { title: "You can't pick a size", short: "couldn't pick size 10", fix: "Add a Size option with real sizes (8, 9, 10…).", why: "Agents almost always pick the product that clearly fits the request." },
  SHIPPING_ETA_MISSING: { title: "No delivery date before checkout", short: "no delivery date", fix: "Say ‘Arrives in 3–5 business days’ in your shipping policy." },
  RETURNS_WINDOW_MISSING: { title: "Return policy doesn't say how many days", short: "no return window", fix: "Write it plainly: ‘30-day returns’." },
  RETURNS_POLICY_MISSING: { title: "No return policy", short: "no return policy", fix: "Publish a refund policy that states the return window in days." },
  CHECKOUT_BOT_WALL: { title: "Checkout blocks AI shoppers", short: "blocked at checkout", fix: "Let a cart created by an agent reach checkout without a bot challenge." },
}

function plainIssue(code: string, summary: string, fix: string) {
  return PLAIN_ISSUE[code] ?? { title: summary, short: summary.replace(/\.$/, "").toLowerCase(), fix }
}

interface FixProposal {
  id: string
  title: string
  before: string
  after: string
  summary: string
  writes: boolean
  status: "proposed" | "applied" | "skipped" | "failed" | "reverted"
  error: string | null
}
interface FixerState {
  sessionId: string
  dryRun: boolean
  proposals: FixProposal[]
  scoreBefore: number
  scoreAfter: number | null
  canRevert: boolean
  error: string | null
}

async function fixerCall(body: Record<string, unknown>): Promise<FixerState> {
  const response = await fetch("/api/fixer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error ?? "The fixer failed.")
  return json as FixerState
}

function ResetStoreButton() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  async function reset() {
    if (!window.confirm("Reset the demo store to its original state?")) return
    setBusy(true)
    setNote(null)
    try {
      const response = await fetch("/api/reset-store", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      const json = await response.json()
      setNote(response.ok ? (json.dryRun ? "Nothing to reset (no Shopify credentials)." : "Store reset to the demo baseline.") : json.error ?? "Reset failed.")
    } catch {
      setNote("Reset failed.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={busy} onClick={() => void reset()} className="text-[12px] text-[#26251E] underline decoration-[#E6E5E0] underline-offset-4 disabled:opacity-40">
        {busy ? "Resetting…" : "Reset store for demo"}
      </button>
      {note ? <span className="text-[12px] text-[#8A8984]">{note}</span> : null}
    </span>
  )
}

function FixesPanel({ report, messages, onRerun }: { report: ReportView; messages: RelayMessage[]; onRerun: () => void }) {
  const [state, setState] = useState<FixerState | null>(null)
  const [busy, setBusy] = useState<string | null>("open")
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fixerCall({
      action: "open",
      storeUrl: report.storeUrl,
      findings: report.findings.map((f) => ({ code: f.code, summary: f.summary })),
      relayMessages: messages.map((m) => ({ channel: m.channel, text: m.text })),
    })
      .then(setState)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(null))
  }, [report.runId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function applyOne(id: string) {
    if (!state) return
    setBusy(id)
    setErr(null)
    try {
      let next = state
      for (const p of state.proposals) {
        if (!p.writes || p.status === "applied") continue
        next = await fixerCall({ action: "approve", sessionId: state.sessionId, proposalId: p.id, approved: p.id === id })
      }
      next = await fixerCall({ action: "apply", sessionId: state.sessionId })
      setState(next)
      if (next.error) setErr(next.error)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  async function revert() {
    if (!state) return
    setBusy("revert")
    try {
      setState(await fixerCall({ action: "revert", sessionId: state.sessionId }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!state) return <p className="mt-6 text-[14px] text-[#8A8984]">{err ?? "Reading the store and drafting fixes…"}</p>
  const writable = state.proposals.filter((p) => p.writes)
  const anyApplied = writable.some((p) => p.status === "applied")
  return (
    <div className="mt-6 border-t border-[#E6E5E0] pt-6">
      <p className="mb-3 text-[11px] uppercase tracking-[0.08em] text-[#8A8984]">
        Potential fixes · {state.dryRun ? "dry run, nothing is written" : "writes to your Shopify store"}
      </p>
      {writable.length === 0 ? <p className="text-[14px] text-[#8A8984]">No fixes the agent can write for this store.</p> : null}
      <ul className="border-t border-[#E6E5E0]">
        {writable.map((p) => (
          <li key={p.id} className="border-b border-[#E6E5E0] py-3 text-[14px]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p>{p.title}</p>
                <p className="mt-1 text-[12px] text-[#8A8984]">{p.summary}</p>
              </div>
              {p.status === "applied" ? (
                <span className="shrink-0 text-[12px] text-[#1F7A72]">Applied</span>
              ) : (
                <button
                  disabled={busy != null}
                  onClick={() => void applyOne(p.id)}
                  className="h-8 shrink-0 rounded-[6px] bg-[#14130F] px-3 text-[13px] text-white disabled:opacity-40"
                >
                  {busy === p.id ? "Applying…" : "Apply"}
                </button>
              )}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-[#8A8984]">Preview change</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-[0.08em] text-[#8A8984]">Before</p>
                  <p className="whitespace-pre-wrap text-[13px] text-[#8A8984]">{p.before || "(empty)"}</p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-[0.08em] text-[#8A8984]">After</p>
                  <p className="whitespace-pre-wrap text-[13px]">{p.after}</p>
                </div>
              </div>
            </details>
            {p.error ? <p className="mt-1 text-[12px] text-[#9A3412]">{p.error}</p> : null}
          </li>
        ))}
      </ul>
      {err ? <p className="mt-3 text-[13px] text-[#9A3412]">{err}</p> : null}
      {!anyApplied ? <p className="mt-3"><ResetStoreButton /></p> : null}
      {anyApplied ? (
        <div className="mt-4 flex items-center gap-3">
          <button onClick={onRerun} className="h-10 rounded-[6px] bg-[#14130F] px-4 text-[14px] text-white">Run shoppers again →</button>
          <button disabled={busy != null || !state.canRevert} onClick={() => void revert()} className="h-10 rounded-[6px] border border-[#E6E5E0] px-4 text-[14px] disabled:opacity-40">
            {busy === "revert" ? "Reverting…" : "Revert all"}
          </button>
          <ResetStoreButton />
          {state.scoreAfter != null ? <span className="text-[13px] text-[#8A8984]">Projected score {state.scoreBefore} → {state.scoreAfter}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export function AuditBoard() {
  const [config, setConfig] = useState<Config | null>(null)
  const [mode, setMode] = useState<"fixture" | "live">("fixture")
  const [fixture, setFixture] = useState<"before" | "after">("before")
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shoppers, setShoppers] = useState<ShopperView[]>(idleShoppers)
  const [report, setReport] = useState<ReportView | null>(null)
  const [messages, setMessages] = useState<RelayMessage[]>([])
  const [relayLabel, setRelayLabel] = useState("Local transcript")
  const [storeUrl, setStoreUrl] = useState("")
  // Held in memory for one request only. Never logged, persisted, or echoed back.
  const [password, setPassword] = useState("")
  const logRef = useRef<HTMLDivElement>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [previousTotal, setPreviousTotal] = useState<number | null>(null)
  const sourceRef = useRef<EventSource | null>(null)
  const [showFixes, setShowFixes] = useState(false)
  const [intents, setIntents] = useState<Record<string, string> | null>(null)

  useEffect(() => () => sourceRef.current?.close(), [])

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json())
      .then((body: Config) => {
        setConfig(body)
        setStoreUrl((current) => current || body.shopUrl)
      })
      .catch(() => setError("The dashboard could not read its config."))
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])


  async function run(next?: { mode: "fixture" | "live"; fixture: "before" | "after" }) {
    const chosenMode = next?.mode ?? mode
    const chosenFixture = next?.fixture ?? fixture
    setMode(chosenMode)
    setFixture(chosenFixture)
    setRunning(true)
    setError(null)
    setPreviousTotal(report?.status === "final" ? report.total : previousTotal)
    setReport(null)
    setShowFixes(false)
    if (chosenMode === "live") {
      void fetch("/api/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeUrl: storeUrl.trim(), password: password || undefined }) })
        .then((r) => r.json())
        .then((body: Record<string, string>) => setIntents(body))
        .catch(() => setIntents(null))
    } else setIntents(null)
    setStartedAt(Date.now())
    setMessages([])
    setShoppers(idleShoppers())
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        chosenMode === "live"
          ? { mode: chosenMode, fixture: chosenFixture, storeUrl: storeUrl.trim(), password: password || undefined }
          : { mode: chosenMode, fixture: chosenFixture },
      ),
    })
    if (!response.ok) {
      setRunning(false)
      setError("Could not start the run.")
      return
    }
    const { id } = (await response.json()) as { id: string }
    sourceRef.current?.close()
    const source = new EventSource(`/api/runs/${id}/events`)
    sourceRef.current = source
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as
        | { type: "shopper"; view: ShopperView }
        | { type: "report"; report: ReportView }
        | { type: "relay"; message: RelayMessage }
        | { type: "meta"; relay: "local" | "agent-relay"; storeUrl: string }
        | { type: "done" }
        | { type: "end" }
        | { type: "error"; message: string }
      if (payload.type === "shopper") {
        setShoppers((current) => current.map((shopper) => (shopper.persona === payload.view.persona ? payload.view : shopper)))
      } else if (payload.type === "report") {
        setReport(payload.report)
      } else if (payload.type === "relay") {
        setMessages((current) => [...current, payload.message])
      } else if (payload.type === "meta") {
        setRelayLabel(payload.relay === "agent-relay" ? "Agent Relay" : "Local transcript")
      } else if (payload.type === "error") {
        setError(payload.message)
        setRunning(false)
      } else if (payload.type === "done" || payload.type === "end") {
        setRunning(false)
        source.close()
      }
    }
    source.onerror = () => {
      setRunning(false)
      source.close()
    }
  }

  const delta = report?.status === "final" && previousTotal != null ? report.total - previousTotal : null
  const label = mode === "live" ? "Live store" : fixture === "after" ? "Recorded store, after fix" : "Recorded store"
  const final = report?.status === "final"
  const bought = shoppers.filter((s) => s.cartVariantId != null).length
  const lbl = "text-[11px] uppercase tracking-[0.08em] text-[#8A8984]"

  return (
    <>
    <nav className="border-b border-[#E6E5E0]">
      <div className="mx-auto flex h-14 max-w-[960px] items-center gap-6 px-6">
        <span className="text-[18px] font-semibold tracking-[-0.03em]">tiebreaks.</span>
        <span className="text-[13px] text-[#26251E]">Audit your store</span>
        <span className="ml-auto rounded-[4px] border border-[#E6E5E0] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[#8A8984]">Five agent shoppers</span>
      </div>
    </nav>
    <main className="mx-auto w-full max-w-[960px] px-6 pt-8 pb-16">
      <h1 className="text-[24px] leading-[1.25] tracking-[-0.02em]">Can AI shoppers buy from your store?</h1>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault()
          void run({ mode: "live", fixture: "before" })
        }}
      >
        <input aria-label="Store URL" placeholder="yourstore.com" spellCheck={false} value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)}
          className="h-10 flex-1 rounded-[8px] border border-[#E6E5E0] bg-white px-3 font-mono text-[13px] text-[#26251E] outline-none placeholder:text-[#8A8984] focus:border-[#8A8984]" />
        <input aria-label="Storefront password (optional)" type="password" autoComplete="off" placeholder="Storefront password (optional)" value={password} onChange={(event) => setPassword(event.target.value)}
          className="h-10 rounded-[8px] border border-[#E6E5E0] bg-white px-3 text-[13px] text-[#26251E] outline-none placeholder:text-[#8A8984] focus:border-[#8A8984] sm:w-56" />
        <button type="submit" disabled={running || !storeUrl.trim()} className="h-10 rounded-[6px] bg-[#14130F] px-5 text-[14px] text-white disabled:opacity-40">
          {running ? "Shoppers running…" : "Send 5 shoppers →"}
        </button>
      </form>
      {error ? <p className="mt-3 text-[14px] text-[#9A3412]">{error}</p> : null}

      <section className="mt-8">
        <p className={lbl + " mb-2"}>The shoppers</p>
        <div className="border-t border-[#E6E5E0]">
          {shoppers.map((shopper) => {
            const plain = PLAIN_PERSONA[shopper.persona] ?? { name: shopper.persona, intent: shopper.goal }
            const blocker = shopper.blockerCodes[0]
            const ok = shopper.cartVariantId != null
            const finished = shopper.status === "done" || shopper.status === "blocked" || shopper.status === "error" || (final && shopper.status !== "running")
            const finding = report?.findings.find((f) => f.code === blocker)
            const why = blocker ? plainIssue(blocker, finding?.summary ?? blocker, "").short : "could not finish"
            return (
              <div key={shopper.persona} className="grid grid-cols-[160px_1fr_220px] items-center gap-4 border-b border-[#E6E5E0] py-3 text-[14px]">
                <p className="flex items-center gap-2">
                  <span className={`inline-block size-1.5 rounded-full ${DOT[shopper.status] ?? DOT.idle}`} />
                  {plain.name}
                </p>
                <div className="min-w-0">
                  <p>{intents?.[shopper.persona] ?? plain.intent}</p>
                  {shopper.status === "running" ? <p className="mt-1 truncate text-[12px] text-[#8A8984]">{shopper.step}</p> : null}
                </div>
                <p className={`text-right text-[13px] ${!finished || shopper.status === "idle" ? "text-[#8A8984]" : ok ? "text-[#1F7A72]" : "text-[#C2410C]"}`}>
                  {shopper.status === "idle" ? "Waiting" : !finished ? "Shopping…" : ok ? "Added to cart" : `Gave up: ${why}`}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-8 rounded-[8px] border border-[#E6E5E0] bg-white p-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="text-[40px] leading-none tracking-[-0.03em] tabular-nums">
            {report ? report.total : "–"}<span className="text-[20px] text-[#B5B4AE]"> / 100</span>
          </p>
          <p className="text-[14px] text-[#8A8984]">
            {report ? `${bought} of 5 shoppers could buy` : "Run the shoppers to get a score"}
            {delta != null && delta !== 0 ? <span className="ml-2 text-[#F54E00]">{delta > 0 ? "+" : ""}{delta} since last run</span> : null}
          </p>
          {final && report.findings.length > 0 ? (
            <button onClick={() => setShowFixes((v) => !v)} className="ml-auto h-10 rounded-[6px] bg-[#14130F] px-4 text-[14px] text-white">
              {showFixes ? "Hide fixes" : "See potential fixes →"}
            </button>
          ) : null}
        </div>
        {report?.categories?.length ? (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {report.categories.map((category) => (
              <span key={category.id} className="flex items-center gap-2 text-[12px] text-[#8A8984]">
                {category.label}
                <span className="h-px w-12 bg-[#E6E5E0]"><span className="block h-px bg-[#26251E]" style={{ width: `${category.score}%` }} /></span>
              </span>
            ))}
          </div>
        ) : null}
        {showFixes && report ? <FixesPanel report={report} messages={messages} onRerun={() => void run()} /> : null}
      </section>

      {report && report.findings.length > 0 ? (
        <section className="mt-8">
          <p className={lbl + " mb-2"}>What stopped them</p>
          <ul className="border-t border-[#E6E5E0]">
            {report.findings.map((finding) => {
              const plain = plainIssue(finding.code, finding.summary, finding.fix)
              const names = finding.personas.map((id) => PLAIN_PERSONA[id]?.name ?? id)
              return (
                <li key={finding.code} className="border-b border-[#E6E5E0] py-3 text-[14px]">
                  <div className="flex items-baseline justify-between gap-4">
                    <p>{plain.title}</p>
                    {names.length ? <p className="shrink-0 text-[12px] text-[#8A8984]">Blocked: {names.join(", ")}</p> : null}
                  </div>
                  <p className="mt-1 text-[13px] text-[#8A8984]">Fix: {plain.fix}</p>
                  {plain.why ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-[#8A8984]">Why</summary>
                      <p className="mt-1 text-[13px] text-[#8A8984]">{plain.why}</p>
                    </details>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <details className="mt-8">
        <summary className="cursor-pointer text-[12px] text-[#8A8984]">Live agent chat ({relayLabel}, #floor and #findings) · replay a recording</summary>
        <p className="mt-3 text-[12px] text-[#8A8984]">
          Replay:{" "}
          <button disabled={running} onClick={() => void run({ mode: "fixture", fixture: "before" })} className="text-[#26251E] underline decoration-[#E6E5E0] underline-offset-4 disabled:opacity-40">recorded store</button>{" "}·{" "}
          <button disabled={running} onClick={() => void run({ mode: "fixture", fixture: "after" })} className="text-[#26251E] underline decoration-[#E6E5E0] underline-offset-4 disabled:opacity-40">after shipping fix</button>
          {" "}· {label} · <ResetStoreButton />
        </p>
        <div ref={logRef} role="log" aria-label="Relay messages" className="mt-3 max-h-[360px] overflow-y-auto rounded-[8px] border border-[#E6E5E0] bg-white px-4 py-3">
          {messages.length === 0 ? (
            <p className="font-mono text-[12px] text-[#8A8984]">Waiting for a run.</p>
          ) : (
            messages.map((message) => (
              <p key={message.id} className="grid grid-cols-[56px_96px_1fr] gap-3 py-[3px] text-[13px] leading-snug">
                <span className="font-mono text-[11px] text-[#8A8984] tabular-nums">{relTime(message.at, startedAt)}</span>
                <span className="font-mono text-[11px] text-[#8A8984]">{message.channel === "findings" ? "#findings" : message.from}</span>
                <span>{message.channel === "findings" ? message.text : <LogText text={message.text} />}</span>
              </p>
            ))
          )}
        </div>
      </details>
    </main>
    </>
  )
}

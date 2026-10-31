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
  return <p className="mb-3 text-[13px] text-[#8A8984]">{children}</p>
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

  return (
    <main className="mx-auto w-full max-w-[880px] px-6 pt-24 pb-32">
      <header>
        <Eyebrow>Agent readiness</Eyebrow>
        <h1 className="max-w-[640px] text-[28px] leading-[1.2] tracking-[-0.02em]">
          Can AI agents buy from your store? <span className="text-[#8A8984]">Five shoppers try. The rubric scores.</span>
        </h1>
        <p className="mt-4 text-[13px] text-[#8A8984]">
          {relayLabel} · {config?.openai ? "Model on for live" : "Rules only"} ·{" "}
          {config?.passwordSet ? "Server password set for the default store" : "No server password"}
        </p>
      </header>

      <section className="mt-16">
        <Eyebrow>Store</Eyebrow>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            void run({ mode: "live", fixture: "before" })
          }}
        >
          <input
            aria-label="Store URL"
            placeholder="yourstore.com"
            spellCheck={false}
            value={storeUrl}
            onChange={(event) => setStoreUrl(event.target.value)}
            className="h-10 flex-1 rounded-[3px] border border-[#E6E5E0] bg-[#F0EFEB] px-3 font-mono text-[13px] text-[#26251E] outline-none placeholder:text-[#8A8984] focus:border-[#8A8984]"
          />
          <input
            aria-label="Storefront password (optional)"
            type="password"
            autoComplete="off"
            placeholder="Storefront password (optional)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-10 rounded-[3px] border border-[#E6E5E0] bg-[#F0EFEB] px-3 text-[13px] text-[#26251E] outline-none placeholder:text-[#8A8984] focus:border-[#8A8984] sm:w-56"
          />
          <button
            type="submit"
            disabled={running || !storeUrl.trim()}
            className="h-10 rounded-full bg-[#26251E] px-5 text-[14px] text-[#F7F7F4] disabled:opacity-40"
          >
            {running ? "Running…" : "Run audit →"}
          </button>
        </form>
        <p className="mt-3 text-[13px] text-[#8A8984]">
          Or replay a recording:{" "}
          <button disabled={running} onClick={() => void run({ mode: "fixture", fixture: "before" })} className="text-[#26251E] underline decoration-[#E6E5E0] underline-offset-4 hover:decoration-[#26251E] disabled:opacity-40">
            recorded store
          </button>{" "}
          ·{" "}
          <button disabled={running} onClick={() => void run({ mode: "fixture", fixture: "after" })} className="text-[#26251E] underline decoration-[#E6E5E0] underline-offset-4 hover:decoration-[#26251E] disabled:opacity-40">
            after shipping fix
          </button>
        </p>
      </section>

      {error ? (
        <section className="mt-10 rounded-[3px] border border-[#E6E5E0] bg-[#F0EFEB] px-5 py-4 text-[14px]">
          <p>{error}</p>
          <button onClick={() => void run({ mode: "fixture", fixture: "before" })} className="mt-2 text-[13px] text-[#F54E00]">
            Replay the recorded store instead →
          </button>
        </section>
      ) : null}

      <section className="mt-20" aria-live="polite">
        <Eyebrow>Score · {label}</Eyebrow>
        <div className="flex items-baseline gap-3">
          <p className="text-[88px] leading-none tracking-[-0.04em] tabular-nums">
            {report ? report.total : "–"}
            <span className="text-[#B5B4AE]">/100</span>
          </p>
          {delta != null && delta !== 0 ? (
            <span className="font-mono text-[14px] text-[#F54E00] tabular-nums">
              {delta > 0 ? "+" : ""}
              {delta}
            </span>
          ) : null}
        </div>
        {report ? (
          <p className="mt-3 font-mono text-[12px] text-[#8A8984]">
            {report.storeUrl} · run {report.runId} · {report.status}
          </p>
        ) : null}
        {report?.categories?.length ? (
          <div className="mt-8 border-t border-[#E6E5E0]">
            {report.categories.map((category) => (
              <div key={category.id} className="flex items-center justify-between border-b border-[#E6E5E0] py-2 text-[14px]">
                <span>{category.label}</span>
                <span className="flex items-center gap-4">
                  <span className="h-px w-32 bg-[#E6E5E0]">
                    <span className="block h-px bg-[#26251E]" style={{ width: `${category.score}%` }} />
                  </span>
                  <span className="w-14 text-right font-mono text-[12px] text-[#8A8984] tabular-nums">
                    {category.weighted}/{category.weight}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-20">
        <Eyebrow>Shoppers</Eyebrow>
        <div className="border-t border-[#E6E5E0]">
          {shoppers.map((shopper) => (
            <div key={shopper.persona} className="grid grid-cols-[140px_1fr_auto] gap-4 border-b border-[#E6E5E0] py-3 text-[14px]">
              <div>
                <p>{PERSONAS[shopper.persona as PersonaId].label}</p>
                <p className="mt-1 flex items-center gap-2 text-[12px] text-[#8A8984]">
                  <span className={`inline-block size-1.5 rounded-full ${DOT[shopper.status] ?? DOT.idle}`} />
                  {shopper.status}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[#8A8984]">{shopper.goal}</p>
                <p className="mt-1 truncate">
                  <LogText text={shopper.step} />
                </p>
                {report ? (
                  <p className="mt-1 font-mono text-[11px] text-[#8A8984]">
                    Shopper/{report.runId}.{shopper.persona}
                    {shopper.cartVariantId != null ? ` · variant ${shopper.cartVariantId}` : ""}
                    {shopper.blockerCodes.length ? ` · ${shopper.blockerCodes.join(" ")}` : ""}
                  </p>
                ) : null}
              </div>
              <p className="text-right font-mono text-[13px] tabular-nums">
                {shopper.missionScore ?? "–"}
                <span className="text-[#8A8984]"> · {shopper.stepsDone}</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <Eyebrow>Fixes</Eyebrow>
        {report == null ? (
          <p className="text-[14px] text-[#8A8984]">Fixes appear as the report actor records them.</p>
        ) : report.findings.length === 0 ? (
          <p className="text-[14px]">No findings.</p>
        ) : (
          <ol className="border-t border-[#E6E5E0]">
            {report.findings.map((finding) => (
              <li key={finding.code} className="grid grid-cols-[220px_1fr] gap-4 border-b border-[#E6E5E0] py-4 text-[14px]">
                <div>
                  <p className="font-mono text-[12px]">{finding.code}</p>
                  <p className="mt-1 text-[12px] text-[#8A8984]">
                    {finding.severity}
                    {finding.personas.length ? ` · ${finding.personas.join(", ")}` : ""}
                  </p>
                </div>
                <div>
                  <p>{finding.summary}</p>
                  <p className="mt-1 text-[#8A8984]">{finding.fix}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-20">
        <Eyebrow>Feed · #floor and #findings</Eyebrow>
        <div
          ref={logRef}
          role="log"
          aria-label="Relay messages"
          className="max-h-[480px] overflow-y-auto rounded-[3px] border border-[#E6E5E0] bg-[#F0EFEB] px-4 py-3"
        >
          {messages.length === 0 ? (
            <p className="font-mono text-[12px] text-[#8A8984]">Waiting for a run.</p>
          ) : (
            messages.map((message) => (
              <p key={message.id} className="grid grid-cols-[56px_96px_1fr] gap-3 py-[3px] text-[13px] leading-snug">
                <span className="font-mono text-[11px] text-[#8A8984] tabular-nums">{relTime(message.at, startedAt)}</span>
                <span className="font-mono text-[11px] text-[#8A8984]">
                  {message.channel === "findings" ? "#findings" : message.from}
                </span>
                <span className={message.channel === "findings" ? "font-mono text-[12px] text-[#8A8984]" : ""}>
                  {message.channel === "findings" ? message.text : <LogText text={message.text} />}
                </span>
              </p>
            ))
          )}
        </div>
      </section>
    </main>
  )
}

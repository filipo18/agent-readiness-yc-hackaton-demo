"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { PERSONAS, PERSONA_IDS, type PersonaId, type ReportView, type ShopperView } from "@readiness/protocol"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface RelayMessage {
  id: string
  channel: "floor" | "findings"
  from: string
  text: string
}

interface Config {
  shopUrl: string
  passwordSet: boolean
  openai: boolean
  relay: boolean
}

const TONE: Record<string, string> = {
  bargain: "text-amber-700 dark:text-amber-200",
  gift: "text-emerald-700 dark:text-emerald-200",
  spec: "text-sky-700 dark:text-sky-200",
  impatient: "text-rose-700 dark:text-rose-200",
  returns: "text-violet-700 dark:text-violet-200",
  coordinator: "text-muted-foreground",
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

function statusVariant(status: ShopperView["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "running") return "default"
  if (status === "blocked" || status === "error") return "destructive"
  if (status === "done") return "secondary"
  return "outline"
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
  const logRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => () => sourceRef.current?.close(), [])

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json())
      .then((body: Config) => setConfig(body))
      .catch(() => setError("The dashboard could not read its config."))
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages])

  const findingCount = report?.findings.length ?? 0
  const headline = useMemo(() => {
    if (error) return "Run stopped"
    if (running) return "Shoppers are in the store"
    if (report?.status === "final") return "Audit finished"
    return "Ready when you are"
  }, [error, report?.status, running])

  async function run(next?: { mode: "fixture" | "live"; fixture: "before" | "after" }) {
    const chosenMode = next?.mode ?? mode
    const chosenFixture = next?.fixture ?? fixture
    setMode(chosenMode)
    setFixture(chosenFixture)
    setRunning(true)
    setError(null)
    setReport(null)
    setMessages([])
    setShoppers(idleShoppers())
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: chosenMode, fixture: chosenFixture }),
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Agent readiness</p>
          <h1 className="text-2xl font-semibold tracking-tight">{headline}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Five shoppers try to buy Brooks Men&apos;s Ghost 18 on{" "}
            <span className="text-foreground">{config?.shopUrl ?? "the dev store"}</span>. Nobody pays. The score is a rubric.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{relayLabel}</Badge>
          <Badge variant="outline">{config?.passwordSet ? "Password set" : "No storefront password"}</Badge>
          <Badge variant="outline">{config?.openai ? "Model on for live" : "Rules only"}</Badge>
        </div>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button disabled={running} onClick={() => void run({ mode: "fixture", fixture: "before" })}>
          Run recorded store
        </Button>
        <Button variant="outline" disabled={running} onClick={() => void run({ mode: "fixture", fixture: "after" })}>
          Run after shipping fix
        </Button>
        <Button variant="secondary" disabled={running} onClick={() => void run({ mode: "live", fixture: "before" })}>
          Run live store
        </Button>
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not finish</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>{error}</p>
            <Button variant="outline" className="w-fit" onClick={() => void run({ mode: "fixture", fixture: "before" })}>
              Run the recorded store instead
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <section className="flex flex-col gap-3" aria-label="Shoppers">
          {shoppers.map((shopper) => (
            <Card key={shopper.persona} size="sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className={TONE[shopper.persona]}>{PERSONAS[shopper.persona as PersonaId].label}</CardTitle>
                  <Badge variant={statusVariant(shopper.status)}>{shopper.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                <p className="text-muted-foreground">{shopper.goal}</p>
                <p>{shopper.step}</p>
                <p className="text-xs text-muted-foreground">
                  {shopper.stepsDone} steps
                  {shopper.missionScore != null ? ` · mission ${shopper.missionScore}` : ""}
                  {shopper.cartVariantId != null ? ` · variant ${shopper.cartVariantId}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="flex flex-col gap-4" aria-live="polite">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Store score</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-6xl font-semibold tabular-nums">{report ? report.total : "–"}</p>
              <p className="text-sm text-muted-foreground">
                {report == null
                  ? "Paste is unnecessary on the recorded store. Live mode uses SHOP_URL and the storefront password from the server."
                  : `${findingCount} fixes. Shipping is the one-line edit. VIZ titles and returns stay open on purpose.`}
              </p>
              <div className="flex flex-col gap-2">
                {(report?.categories ?? []).map((category) => (
                  <div key={category.id}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{category.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {category.weighted}/{category.weight}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-foreground" style={{ width: `${category.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fixes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {report == null ? (
                <p className="text-sm text-muted-foreground">Findings show up as the report actor records them.</p>
              ) : report.findings.length === 0 ? (
                <p className="text-sm">No findings. That would be a surprising store.</p>
              ) : (
                report.findings.map((finding) => (
                  <div key={finding.code} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={finding.severity === "minor" ? "outline" : finding.severity === "blocker" ? "destructive" : "secondary"}>
                        {finding.severity}
                      </Badge>
                      <span className="text-sm font-medium">{finding.summary}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{finding.fix}</p>
                    {finding.personas.length > 0 ? (
                      <p className="text-xs text-muted-foreground">Seen by {finding.personas.join(", ")}</p>
                    ) : null}
                    <Separator />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="min-h-80 lg:min-h-0">
          <CardHeader>
            <CardTitle>#floor and #findings</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <ScrollArea className="h-[28rem] lg:h-[calc(100vh-14rem)]">
              <div ref={logRef} className="flex flex-col gap-3 pr-3" role="log" aria-label="Relay messages">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Shoppers talk here. Findings are JSON so the report actor can record them once.</p>
                ) : (
                  messages.map((message) => (
                    <p key={message.id} className="text-sm leading-snug">
                      <span className="mr-2 text-xs text-muted-foreground">#{message.channel}</span>
                      <span className={`font-medium ${TONE[message.from] ?? ""}`}>{message.from}</span>
                      <span className="text-muted-foreground"> · </span>
                      {message.text}
                    </p>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

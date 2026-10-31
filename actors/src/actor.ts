import { Actor, Compute, Emittable, Interleave, Persisted, type ActorSocket } from "terse-sdk/actor"
import {
  PERSONAS,
  blankEvidence,
  scoreMission,
  viewFromEvidence,
  type MissionEvidence,
  type PersonaId,
  type ReportView,
  type ShopperView,
  type StoreEvidence,
} from "@readiness/protocol"
import { loadSnapshot, shopPersona, shopUrlFromEnv } from "@readiness/shop"

type Watcher = { watcher: string }
type Incoming = { type: "ping" }
type Outgoing = { type: "log"; line: string }
type Socket = ActorSocket<Watcher, Outgoing>

export type { ShopperView }

export interface AssignInput {
  runId: string
  persona: PersonaId
  storeUrl: string
  /** Agent Relay token for this persona. Persisted, never emitted to the dashboard. */
  relayToken: string
}

/**
 * One shopper. The actor id is `${runId}.${persona}`.
 * `@Interleave` is required: LLM and HTTP awaits must not freeze the mailbox,
 * or the dashboard cannot read state mid-run.
 * Do not call `this.db.transaction` in this class. Any `@Interleave` method
 * makes transactions throw for the whole class.
 * Reassign arrays. `this.steps.push(...)` is not persisted.
 */
@Compute({ cpu: 0.5, memoryMiB: 512, idleTimeoutMs: 60_000 })
export class Shopper extends Actor<Watcher, Incoming, Outgoing> {
  @Persisted @Emittable view: ShopperView = {
    persona: "bargain",
    status: "idle",
    goal: "",
    step: "waiting",
    stepsDone: 0,
    cartVariantId: null,
    missionScore: null,
    blockerCodes: [],
  }

  @Persisted private runId = ""
  @Persisted private storeUrl = ""
  @Persisted private relayToken = ""
  @Persisted private steps: string[] = []

  async assign(input: AssignInput): Promise<ShopperView> {
    this.runId = input.runId
    this.storeUrl = input.storeUrl
    this.relayToken = input.relayToken
    this.steps = []
    this.view = {
      persona: input.persona,
      status: "idle",
      goal: PERSONAS[input.persona].goal,
      step: "assigned",
      stepsDone: 0,
      cartVariantId: null,
      missionScore: null,
      blockerCodes: [],
    }
    return this.view
  }

  /**
   * Shops one persona. The caller posts Relay lines and submits the mission
   * to StoreReport. This method does not write the shared score.
   */
  @Interleave
  /** `password` is an RPC argument only: never persisted, emitted, or logged. */
  async shop(password: string | null = null): Promise<MissionEvidence> {
    void this.relayToken
    this.view = { ...this.view, status: "running", step: "Opening the store" }
    this.alarm.set(Date.now() + 90_000)
    const mode = process.env.SHOP_MODE === "live" ? "live" : "fixture"
    const fixture = process.env.SHOP_FIXTURE === "after" ? "after" : "before"
    const snapshot = await loadSnapshot({
      mode,
      fixture,
      storeUrl: this.storeUrl || shopUrlFromEnv(),
      password: password ?? undefined,
    })
    const outcome = await shopPersona({
      persona: this.view.persona,
      snapshot,
      liveCart: mode === "live",
      useModel: mode === "live" && Boolean(process.env.OPENAI_API_KEY?.trim()),
    })
    for (const line of outcome.steps) {
      this.steps = [...this.steps, line]
      this.view = { ...this.view, step: line, stepsDone: this.steps.length }
      this.alarm.set(Date.now() + 90_000)
    }
    const missionScore = scoreMission(this.view.persona, outcome.mission, snapshot.evidence).score
    this.view = {
      ...this.view,
      status: outcome.mission.abandoned ? "blocked" : "done",
      step: outcome.steps.at(-1) ?? "Finished",
      stepsDone: outcome.steps.length,
      cartVariantId: outcome.cartVariantId,
      missionScore,
      blockerCodes: outcome.blockerCodes,
    }
    this.alarm.delete()
    return outcome.mission
  }

  async onAlarm(): Promise<void> {
    if (this.view.status !== "running") return
    this.view = {
      ...this.view,
      status: "blocked",
      step: "stalled",
      blockerCodes: [...this.view.blockerCodes, "STALL"],
    }
    this.broadcast({ type: "log", line: `${this.view.persona} stalled` })
  }

  async onConnect(socket: Socket): Promise<void> {
    socket.send({ type: "log", line: `${this.view.persona} ${this.view.status}` })
  }

  /** Full persisted state, for querying an actor after the run. */
  async state(): Promise<{ runId: string; storeUrl: string; view: ShopperView; steps: string[] }> {
    return { runId: this.runId, storeUrl: this.storeUrl, view: this.view, steps: this.steps }
  }

  /** Steps from the last shop() call, so the caller can stream them to Relay. */
  async lastSteps(): Promise<string[]> {
    return this.steps
  }
}

/**
 * Single writer for the store score. No `@Interleave`: shoppers call
 * `submitMission` and the mailbox runs those writes one at a time.
 */
export { Fixer } from "./fixer.js"

export class StoreReport extends Actor<Watcher, Incoming, Outgoing> {
  @Persisted @Emittable report: ReportView = {
    runId: "",
    storeUrl: "",
    total: 0,
    status: "collecting",
    findings: [],
    categories: [],
    missions: [],
  }

  @Persisted private evidence: StoreEvidence = blankEvidence("")

  async open(runId: string, storeUrl: string, storefront: Omit<StoreEvidence, "missions" | "storeUrl">): Promise<ReportView> {
    this.evidence = { ...storefront, storeUrl, missions: [] }
    this.report = viewFromEvidence(runId, storeUrl, this.evidence, "collecting")
    return this.report
  }

  async submitMission(mission: MissionEvidence): Promise<ReportView> {
    const missions = [...this.evidence.missions.filter((item) => item.persona !== mission.persona), mission]
    this.evidence = { ...this.evidence, missions }
    this.report = viewFromEvidence(this.report.runId, this.report.storeUrl, this.evidence, "collecting")
    this.broadcast({ type: "log", line: `score ${this.report.total}` })
    return this.report
  }

  async finalize(): Promise<ReportView> {
    this.report = viewFromEvidence(this.report.runId, this.report.storeUrl, this.evidence, "final")
    this.broadcast({ type: "log", line: `score ${this.report.total}` })
    return this.report
  }
}

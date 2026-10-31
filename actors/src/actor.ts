import { Actor, Compute, Emittable, Interleave, Persisted, type ActorSocket } from "terse-sdk/actor"
import {
  PERSONAS,
  scoreStore,
  blankEvidence,
  type Finding,
  type MissionEvidence,
  type PersonaId,
  type StoreEvidence,
  type StoreScore,
} from "@readiness/protocol"
import { addToCart, auditStorefront, hasOptionValue, mentions, textOf } from "@readiness/shop"

type Watcher = { watcher: string }
type Incoming = { type: "ping" }
type Outgoing = { type: "log"; line: string }
type Socket = ActorSocket<Watcher, Outgoing>

export interface ShopperView {
  persona: PersonaId
  status: "idle" | "running" | "blocked" | "done" | "error"
  goal: string
  step: string
  stepsDone: number
  cartVariantId: number | null
  missionScore: number | null
  blockerCodes: string[]
}

export interface AssignInput {
  runId: string
  persona: PersonaId
  storeUrl: string
  /** Agent Relay token for this persona. Persisted, never emitted to the dashboard. */
  relayToken: string
}

/**
 * One shopper. The actor id is `${runId}:${persona}`.
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
   * Fill this in hour 2. Intended body:
   * 1. Set status running, reassign `this.view`, set `this.alarm` 90s out.
   * 2. `auditStorefront(this.storeUrl)` once per run (the orchestrator may pass products in instead).
   * 3. Pick a variant with `textOf` / `mentions` / `hasOptionValue` / `addToCart`.
   * 4. Post a line to Agent Relay `#floor` with the agent token (HTTP or SDK).
   * 5. Invoke `finding.report` for each blocker. Do not write the store score here.
   * 6. Return `MissionEvidence` to the caller so it can `StoreReport.submitMission`.
   * Reset the alarm at each step. `onAlarm` marks a stall if this is still running.
   */
  @Interleave
  async shop(): Promise<MissionEvidence> {
    void this.relayToken
    void auditStorefront
    void addToCart
    void textOf
    void mentions
    void hasOptionValue
    this.view = { ...this.view, status: "error", step: "shop() is not implemented yet" }
    throw new Error("Implement Shopper.shop. See the comment on this method and PLAN.md.")
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

  noteStep(line: string): void {
    this.steps = [...this.steps, line]
    this.view = { ...this.view, step: line, stepsDone: this.steps.length }
  }

  async onConnect(socket: Socket): Promise<void> {
    socket.send({ type: "log", line: `${this.view.persona} ${this.view.status}` })
  }
}

export interface ReportView {
  runId: string
  storeUrl: string
  total: number
  status: "collecting" | "final"
  findings: Finding[]
  categories: StoreScore["categories"]
  missions: StoreScore["missions"]
}

/**
 * Single writer for the store score. No `@Interleave`: shoppers call
 * `submitMission` and the mailbox runs those writes one at a time.
 */
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
    const scored = scoreStore(this.evidence)
    this.report = {
      runId,
      storeUrl,
      total: scored.total,
      status: "collecting",
      findings: scored.findings,
      categories: scored.categories,
      missions: scored.missions,
    }
    return this.report
  }

  async submitMission(mission: MissionEvidence): Promise<ReportView> {
    const missions = [...this.evidence.missions.filter((item) => item.persona !== mission.persona), mission]
    this.evidence = { ...this.evidence, missions }
    return this.publish("collecting")
  }

  async finalize(): Promise<ReportView> {
    return this.publish("final")
  }

  private publish(status: ReportView["status"]): ReportView {
    const scored = scoreStore(this.evidence)
    this.report = {
      ...this.report,
      total: scored.total,
      status,
      findings: scored.findings,
      categories: scored.categories,
      missions: scored.missions,
    }
    this.broadcast({ type: "log", line: `score ${scored.total}` })
    return this.report
  }
}

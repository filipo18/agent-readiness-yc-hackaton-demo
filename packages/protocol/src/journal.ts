import type { Finding } from "./findings.ts"
import type { MissionEvidence, PersonaId, StoreEvidence, StoreScore } from "./evidence.ts"
import { scoreStore } from "./score.ts"

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

export interface ReportView {
  runId: string
  storeUrl: string
  total: number
  status: "collecting" | "final"
  findings: Finding[]
  categories: StoreScore["categories"]
  missions: StoreScore["missions"]
}

export function viewFromEvidence(
  runId: string,
  storeUrl: string,
  evidence: StoreEvidence,
  status: ReportView["status"],
): ReportView {
  const scored = scoreStore(evidence)
  return {
    runId,
    storeUrl,
    total: scored.total,
    status,
    findings: scored.findings,
    categories: scored.categories,
    missions: scored.missions,
  }
}

/**
 * In-process stand-in for the StoreReport actor. One chain, so overlapping
 * shoppers cannot interleave a score write. The Terse actor uses the same
 * `viewFromEvidence` projection when it is running.
 */
export class ReportJournal {
  evidence: StoreEvidence | null = null
  report: ReportView | null = null
  private chain: Promise<void> = Promise.resolve()

  open(runId: string, storefront: StoreEvidence): Promise<ReportView> {
    return this.enqueue(() => {
      this.evidence = { ...storefront, storeUrl: storefront.storeUrl, missions: [] }
      this.report = viewFromEvidence(runId, storefront.storeUrl, this.evidence, "collecting")
      return this.report
    })
  }

  submitMission(mission: MissionEvidence): Promise<ReportView> {
    return this.enqueue(() => {
      if (!this.evidence || !this.report) throw new Error("Report is not open")
      const missions = [...this.evidence.missions.filter((item) => item.persona !== mission.persona), mission]
      this.evidence = { ...this.evidence, missions }
      this.report = viewFromEvidence(this.report.runId, this.report.storeUrl, this.evidence, "collecting")
      return this.report
    })
  }

  finalize(): Promise<ReportView> {
    return this.enqueue(() => {
      if (!this.evidence || !this.report) throw new Error("Report is not open")
      this.report = viewFromEvidence(this.report.runId, this.report.storeUrl, this.evidence, "final")
      return this.report
    })
  }

  private enqueue<T>(work: () => T): Promise<T> {
    const run = this.chain.then(work)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

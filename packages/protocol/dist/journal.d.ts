import type { Finding } from "./findings.js";
import type { MissionEvidence, PersonaId, StoreEvidence, StoreScore } from "./evidence.js";
export interface ShopperView {
    persona: PersonaId;
    status: "idle" | "running" | "blocked" | "done" | "error";
    goal: string;
    step: string;
    stepsDone: number;
    cartVariantId: number | null;
    missionScore: number | null;
    blockerCodes: string[];
}
export interface ReportView {
    runId: string;
    storeUrl: string;
    total: number;
    status: "collecting" | "final";
    findings: Finding[];
    categories: StoreScore["categories"];
    missions: StoreScore["missions"];
}
export declare function viewFromEvidence(runId: string, storeUrl: string, evidence: StoreEvidence, status: ReportView["status"]): ReportView;
/**
 * In-process stand-in for the StoreReport actor. One chain, so overlapping
 * shoppers cannot interleave a score write. The Terse actor uses the same
 * `viewFromEvidence` projection when it is running.
 */
export declare class ReportJournal {
    evidence: StoreEvidence | null;
    report: ReportView | null;
    private chain;
    open(runId: string, storefront: StoreEvidence): Promise<ReportView>;
    submitMission(mission: MissionEvidence): Promise<ReportView>;
    finalize(): Promise<ReportView>;
    private enqueue;
}

import { type Finding } from "./findings.js";
import { type MissionEvidence, type MissionScore, type PersonaId, type StoreEvidence, type StoreScore } from "./evidence.js";
export declare function scoreMission(persona: PersonaId, mission: MissionEvidence, evidence: StoreEvidence): MissionScore;
export declare function deriveFindings(evidence: StoreEvidence): Finding[];
/** Pure store score. Shoppers collect evidence; they do not invent the number. */
export declare function scoreStore(evidence: StoreEvidence): StoreScore;

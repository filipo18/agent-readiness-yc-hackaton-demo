export declare const PERSONA_IDS: readonly ["bargain", "gift", "spec", "impatient", "returns"];
export type PersonaId = (typeof PERSONA_IDS)[number];
export interface PersonaSpec {
    id: PersonaId;
    /** One line on the dashboard card. */
    label: string;
    goal: string;
    needsColor: boolean;
    needsSize: boolean;
    needsEta: boolean;
    needsReturns: boolean;
    /** Impatient shopper only. Extra steps mean the path was too long. */
    maxSteps: number | null;
}
export declare const PERSONAS: Record<PersonaId, PersonaSpec>;
/** What one shopper managed to observe. The shopper actor stores this; scoring is pure. */
export interface MissionEvidence {
    persona: PersonaId;
    matchedVariant: boolean;
    /** True when the needed color appears in title, tags, or option values. */
    colorInText: boolean;
    sizeSelectable: boolean;
    cartAccepted: boolean;
    steps: number;
    abandoned: boolean;
}
export interface StoreEvidence {
    storeUrl: string;
    http: {
        productsJsonOk: boolean;
        searchOk: boolean;
        robotsBlocksAgents: boolean;
        productJsonLd: boolean;
        passwordWall: boolean;
        unreachable: boolean;
    };
    catalog: {
        productCount: number;
        /** Share of products with a numeric price on every variant. 0 to 1. */
        pricedRatio: number;
        /** Share of products with at least one image. 0 to 1. */
        imagedRatio: number;
        /**
         * Share of titles that look like experiment rows (`VIZ …`).
         * Missing means 0 so older fixtures keep their catalog score.
         */
        experimentRatio?: number;
    };
    policies: {
        shippingText: string | null;
        refundText: string | null;
        shippingPriceDisclosed: boolean;
        shippingEtaDisclosed: boolean;
        refundWindowDays: number | null;
    };
    checkout: {
        attempted: boolean;
        reached: boolean;
        botWall: boolean;
    };
    missions: MissionEvidence[];
}
export interface CategoryScore {
    id: "discoverability" | "catalog" | "variantFit" | "cart" | "shipping" | "policies" | "checkout";
    label: string;
    /** 0 to 100 before weighting. */
    score: number;
    /** Weight out of 100. */
    weight: number;
    /** Points contributed to the store total. */
    weighted: number;
}
export interface MissionScore {
    persona: PersonaId;
    label: string;
    /** 0 to 100. Did this shopper finish its own job? */
    score: number;
}
export interface StoreScore {
    total: number;
    categories: CategoryScore[];
    missions: MissionScore[];
    findings: import("./findings.ts").Finding[];
}
export declare function blankEvidence(storeUrl: string): StoreEvidence;

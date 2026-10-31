/** Stable codes. Shoppers, the report actor, and the dashboard all use these strings. */
export declare const FINDING_CODES: readonly ["STORE_UNREACHABLE", "STORE_PASSWORD_WALL", "PRODUCTS_JSON_MISSING", "SEARCH_UNUSABLE", "NO_PRODUCT_JSONLD", "ROBOTS_BLOCKS_AGENTS", "PRICE_MISSING", "IMAGE_MISSING", "VARIANT_SPEC_UNMATCHED", "COLOR_NOT_IN_TEXT", "EXPERIMENT_TITLES", "SIZE_OPTION_MISSING", "CART_ADD_FAILED", "SHIPPING_HIDDEN_UNTIL_CHECKOUT", "SHIPPING_ETA_MISSING", "RETURNS_POLICY_MISSING", "RETURNS_WINDOW_MISSING", "CHECKOUT_UNREACHABLE", "CHECKOUT_BOT_WALL", "LISTING_DETAIL_THIN", "CONFLICTING_LISTINGS"];
export type FindingCode = (typeof FINDING_CODES)[number];
export type FindingSeverity = "blocker" | "major" | "minor";
export interface Finding {
    code: FindingCode;
    severity: FindingSeverity;
    /** Short line for the dashboard and for #findings. */
    summary: string;
    /** What to change in the store. Deterministic; not an LLM paragraph. */
    fix: string;
    /** Personas that observed it. Deduped by the report actor. */
    personas: string[];
    /** Evidence from Filip's LLM shopping experiments, when one applies. */
    why?: ResearchNote;
}
export interface ResearchNote {
    experiment: string;
    stat: string;
}
export declare const FIX_COPY: Record<FindingCode, {
    severity: FindingSeverity;
    summary: string;
    fix: string;
}>;
/**
 * Research-backed context. Every number is quoted from Filip's experiments
 * (8 LLMs ranking 25 running-shoe offers). Nothing here is extrapolated.
 */
export declare const RESEARCH: Partial<Record<FindingCode, ResearchNote>>;

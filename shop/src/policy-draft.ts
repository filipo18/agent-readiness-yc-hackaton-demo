import { disclosesShippingEta, disclosesShippingPrice, refundWindowDays } from "./shopify.js"

/** Rubric-valid copy used when OpenAI is unset or the draft fails the checks. */
export const FALLBACK_SHIPPING = "Flat rate $6. Free shipping over $75. Arrives in 3–5 business days."
export const FALLBACK_REFUND = "30-day returns. Unused items can be refunded within 30 days of delivery."

export type PolicyKind = "shipping" | "refund"

export interface PolicyDraft {
  text: string
  source: "openai" | "fallback"
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * One temperature-0 call. The model does not score the store.
 * Shipping must state a price and a day window. Refunds must state a day count.
 */
export async function draftPolicy(
  kind: PolicyKind,
  current: string | null,
  deps?: { fetch?: FetchLike; env?: NodeJS.ProcessEnv },
): Promise<PolicyDraft> {
  const env = deps?.env ?? process.env
  const key = env.OPENAI_API_KEY?.trim()
  const fallback = kind === "shipping" ? FALLBACK_SHIPPING : FALLBACK_REFUND
  if (!key) return { text: fallback, source: "fallback" }
  const fetchImpl = deps?.fetch ?? fetch
  const model = env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              kind === "shipping"
                ? 'Write a Shopify shipping policy as plain text. It must include a dollar price or "free shipping" and a delivery window in days (for example 3-5 business days). Reply with JSON {"text": string}. Do not assign a score. No HTML.'
                : 'Write a Shopify refund policy as plain text. It must include a return window as a number of days (for example 30-day returns). Reply with JSON {"text": string}. Do not assign a score. No HTML.',
          },
          {
            role: "user",
            content: JSON.stringify({
              current: current?.slice(0, 800) ?? null,
              store: "Brooks Ghost 18 running shoes",
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return { text: fallback, source: "fallback" }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = payload.choices?.[0]?.message?.content
    if (!content) return { text: fallback, source: "fallback" }
    const parsed = JSON.parse(content) as { text?: unknown }
    const text = typeof parsed.text === "string" ? parsed.text.replace(/\s+/g, " ").trim() : ""
    if (!text || text.length > 600 || !policyValid(kind, text)) return { text: fallback, source: "fallback" }
    return { text, source: "openai" }
  } catch {
    return { text: fallback, source: "fallback" }
  }
}

export function policyValid(kind: PolicyKind, text: string): boolean {
  if (kind === "shipping") return disclosesShippingPrice(text) && disclosesShippingEta(text)
  return refundWindowDays(text) != null
}

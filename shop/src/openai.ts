import type { PersonaId } from "@readiness/protocol"
import { PERSONAS } from "@readiness/protocol"
import type { ShopifyProduct } from "./shopify.ts"

export interface ModelPick {
  handle: string | null
  reason: string
}

export async function askModel(persona: PersonaId, products: ShopifyProduct[]): Promise<ModelPick | null> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return null
  const catalog = products.slice(0, 40).map((product) => ({
    handle: product.handle,
    title: product.title,
    type: product.product_type,
    options: product.options.map((option) => ({ name: option.name, values: option.values.slice(0, 12) })),
    price: product.variants.find((variant) => variant.available)?.price ?? null,
  }))
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
              "You help a shopping agent pick one product handle from a Shopify catalog. Reply with JSON {\"handle\": string|null, \"reason\": string}. Do not invent a handle. Titles that start with VIZ are A/B test rows, not the real shoe. Never assign a score.",
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: PERSONAS[persona].goal,
              catalog,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = payload.choices?.[0]?.message?.content
    if (!content) return null
    const parsed = JSON.parse(content) as { handle?: unknown; reason?: unknown }
    const handle = typeof parsed.handle === "string" ? parsed.handle : null
    const reason = typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "Model picked a handle."
    if (handle && !products.some((product) => product.handle === handle)) return { handle: null, reason: "Model named a handle that is not in the catalog." }
    return { handle, reason }
  } catch {
    return null
  }
}

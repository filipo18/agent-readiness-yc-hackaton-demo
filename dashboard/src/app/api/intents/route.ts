import { isExperimentTitle, loadSnapshot } from "@readiness/shop"

export const dynamic = "force-dynamic"

const GENERIC = {
  bargain: "Wants the cheapest product in the store.",
  gift: "Needs a gift delivered by Friday.",
  spec: "Needs a product in one exact size or color.",
  impatient: "Will buy anything in stock, but only in 4 clicks or fewer.",
  returns: "Only buys if returns are stated in days.",
}

function money(n: number) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { storeUrl?: string; password?: string }
  try {
    const snap = await loadSnapshot({ mode: "live", fixture: "before", storeUrl: body.storeUrl?.slice(0, 300), password: body.password?.slice(0, 200) })
    const products = snap.products.filter((p) => !isExperimentTitle(p.title))
    if (products.length === 0) return Response.json(GENERIC)
    const price = (p: (typeof products)[number]) => Math.min(...p.variants.map((v) => Number(v.price)).filter(Number.isFinite))
    const counts = new Map<string, number>()
    for (const p of products) if (p.product_type) counts.set(p.product_type, (counts.get(p.product_type) ?? 0) + 1)
    const type = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "product"
    const noun = type.toLowerCase().replace(/s$/, "")
    const ofType = products.filter((p) => p.product_type === type)
    const prices = ofType.map(price).filter(Number.isFinite).sort((a, b) => a - b)
    const median = prices[Math.floor(prices.length / 2)]
    const withOption = ofType.find((p) => p.options.some((o) => o.name.toLowerCase() !== "title" && o.values.length > 1))
    const option = withOption?.options.find((o) => o.name.toLowerCase() !== "title" && o.values.length > 1)
    const spec = withOption && option
      ? `Needs ${withOption.title} in ${option.name.toLowerCase()} ${option.values[option.values.length > 1 ? 1 : 0]}.`
      : `Needs a ${noun} in one exact size, and the size must be selectable.`
    const gift = [...ofType].sort((a, b) => price(a) - price(b))[Math.floor(ofType.length / 2)] ?? products[0]
    return Response.json({
      bargain: median != null ? `Wants the cheapest ${noun} under ${money(median)}.` : `Wants the cheapest ${noun}.`,
      gift: `Needs ${gift.title} (${money(price(gift))}) delivered by Friday.`,
      spec,
      impatient: `Will buy any in-stock ${noun}, but only in 4 clicks or fewer.`,
      returns: `Only buys a ${noun} if returns are stated in days.`,
    })
  } catch {
    return Response.json(GENERIC)
  }
}

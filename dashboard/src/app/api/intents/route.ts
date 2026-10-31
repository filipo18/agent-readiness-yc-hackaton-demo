import { isExperimentTitle, isGhost18, loadSnapshot } from "@readiness/shop"

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
    // Missions target the Brooks Men's Ghost 18, so the intent text describes that product.
    const ghost = snap.products.find((p) => isGhost18(p))
    if (!ghost) return Response.json(GENERIC)
    const price = Math.min(...ghost.variants.map((v) => Number(v.price)).filter(Number.isFinite))
    const hasSize = ghost.options.some((o) => o.name.toLowerCase() === "size")
    const viz = snap.products.filter((p) => isExperimentTitle(p.title)).length
    return Response.json({
      bargain: `Wants the cheapest Brooks Men's Ghost 18 (${money(price)})${viz ? `, skipping ${viz} VIZ test copies` : ""}.`,
      gift: `Gifting the Ghost 18 (${money(price)}); needs delivery within 5 days.`,
      spec: `Wants the Ghost 18 in men's size 10${hasSize ? "." : " (the store has no size option)."}`,
      impatient: "Will buy any in-stock product, but only in 4 steps or fewer.",
      returns: `Only buys the Ghost 18 if the refund policy states a return window in days.`,
    })
  } catch {
    return Response.json(GENERIC)
  }
}

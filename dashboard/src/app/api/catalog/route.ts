import { isExperimentTitle, isGhost18, loadSnapshot } from "@readiness/shop"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { storeUrl?: string }
  try {
    const snap = await loadSnapshot({ mode: "live", fixture: "before", storeUrl: body.storeUrl?.slice(0, 300) })
    const card = (p: (typeof snap.products)[number]) => ({
      title: p.title,
      price: Math.min(...p.variants.map((v) => Number(v.price)).filter(Number.isFinite)),
      image: p.images[0]?.src ?? null,
      type: p.product_type,
    })
    const ghost = snap.products.find((p) => isGhost18(p))
    return Response.json({
      ghost: ghost ? card(ghost) : null,
      viz: snap.products.filter((p) => isExperimentTitle(p.title)).map(card),
    })
  } catch {
    return Response.json({ ghost: null, viz: [] })
  }
}

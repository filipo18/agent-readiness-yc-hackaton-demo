import { resetStore } from "@readiness/shop/reset"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean }
  try {
    const result = await resetStore({ dryRun: body.dryRun === true })
    return Response.json({ dryRun: result.dryRun, baselineCreated: result.baselineCreated, products: result.products, actions: result.actions })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Reset failed." }, { status: 500 })
  }
}

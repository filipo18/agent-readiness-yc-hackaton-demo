import { applyFixer, approveFixer, getFixer, openFixer, rerunFixer, revertFixer } from "@readiness/orchestrator/fixer"

export const dynamic = "force-dynamic"

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "The fixer failed."
  return Response.json({ error: message }, { status: 400 })
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim()
  if (!sessionId) return Response.json({ error: "Missing sessionId" }, { status: 400 })
  try {
    return Response.json(await getFixer(sessionId))
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string
    sessionId?: string
    proposalId?: string
    approved?: boolean
    storeUrl?: string
    findings?: { code?: string; summary?: string }[]
    relayMessages?: { channel?: string; text?: string }[]
  }
  try {
    if (body.action === "open") {
      const findings = (body.findings ?? [])
        .filter((item) => typeof item.code === "string")
        .map((item) => ({ code: item.code as string, summary: typeof item.summary === "string" ? item.summary : "" }))
      const relayMessages = (body.relayMessages ?? [])
        .filter((item) => typeof item.channel === "string" && typeof item.text === "string")
        .map((item) => ({ channel: item.channel as string, text: item.text as string }))
      return Response.json(
        await openFixer({
          storeUrl: typeof body.storeUrl === "string" ? body.storeUrl.slice(0, 300) : undefined,
          findings,
          relayMessages,
        }),
      )
    }
    const sessionId = body.sessionId?.trim()
    if (!sessionId) return Response.json({ error: "Missing sessionId" }, { status: 400 })
    if (body.action === "approve") {
      return Response.json(await approveFixer(sessionId, String(body.proposalId ?? ""), Boolean(body.approved)))
    }
    if (body.action === "apply") return Response.json(await applyFixer(sessionId))
    if (body.action === "revert") return Response.json(await revertFixer(sessionId))
    if (body.action === "rerun") return Response.json(await rerunFixer(sessionId))
    return Response.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    return fail(error)
  }
}

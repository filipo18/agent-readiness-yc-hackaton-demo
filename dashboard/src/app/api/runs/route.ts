import { startSession } from "@/lib/sessions"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    mode?: "fixture" | "live"
    fixture?: "before" | "after"
  }
  const mode = body.mode === "live" ? "live" : "fixture"
  const fixture = body.fixture === "after" ? "after" : "before"
  const session = startSession({
    mode,
    fixture,
    stepMs: Number(process.env.RUN_STEP_MS ?? 280),
    relay: "auto",
  })
  return Response.json({ id: session.id })
}

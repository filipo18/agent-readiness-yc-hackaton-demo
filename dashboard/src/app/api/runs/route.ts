import { startSession } from "@/lib/sessions"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    mode?: "fixture" | "live"
    fixture?: "before" | "after"
    storeUrl?: string
    password?: string
  }
  const mode = body.mode === "live" ? "live" : "fixture"
  const fixture = body.fixture === "after" ? "after" : "before"
  const session = startSession({
    mode,
    fixture,
    storeUrl: typeof body.storeUrl === "string" ? body.storeUrl.slice(0, 300) : undefined,
    storefrontPassword: typeof body.password === "string" ? body.password.slice(0, 200) : undefined,
    stepMs: Number(process.env.RUN_STEP_MS ?? 280),
    relay: "auto",
  })
  return Response.json({ id: session.id })
}

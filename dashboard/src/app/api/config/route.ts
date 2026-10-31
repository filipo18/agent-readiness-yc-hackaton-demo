import { shopUrlFromEnv, storefrontPasswordFromEnv } from "@readiness/shop"

export const dynamic = "force-dynamic"

export function GET() {
  return Response.json({
    shopUrl: shopUrlFromEnv(),
    passwordSet: Boolean(storefrontPasswordFromEnv()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    relay: Boolean(process.env.RELAY_WORKSPACE_KEY?.trim()),
  })
}

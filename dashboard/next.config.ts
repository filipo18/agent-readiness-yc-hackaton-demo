import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@readiness/protocol", "@readiness/shop", "@readiness/orchestrator"],
  serverExternalPackages: ["@agent-relay/sdk", "terse-sdk", "durable-actors"],
}

export default nextConfig

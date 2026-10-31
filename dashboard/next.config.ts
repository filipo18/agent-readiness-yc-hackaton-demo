import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@readiness/protocol", "@readiness/shop", "@readiness/orchestrator"],
  serverExternalPackages: ["@agent-relay/sdk", "terse-sdk", "durable-actors"],
  // Workspace sources use NodeNext-style `./x.js` imports that point at `.ts` files.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }
    return config
  },
}

export default nextConfig

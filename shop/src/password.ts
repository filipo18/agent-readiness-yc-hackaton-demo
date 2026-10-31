/**
 * Shopify Online Store password page.
 * Verified on aiconvertit-demo: GET /password, then POST /password with
 * form_type, utf8, and password. A 302 carries the storefront cookie.
 * The GET also renders an authenticity_token; we send it when it is present
 * so the cookie from that GET matches the token.
 */

export function storefrontPasswordBody(password: string, authenticityToken?: string | null): string {
  const body = new URLSearchParams()
  body.set("form_type", "storefront_password")
  body.set("utf8", "✓")
  body.set("password", password)
  if (authenticityToken) body.set("authenticity_token", authenticityToken)
  return body.toString()
}

export function scrapeAuthenticityToken(html: string): string | null {
  const match = html.match(/name="authenticity_token"\s+value="([^"]+)"/)
  return match?.[1] ?? null
}

export function passwordUnlockSucceeded(status: number, location: string | null, body: string): boolean {
  if (status >= 300 && status < 400) {
    if (!location) return true
    try {
      const path = new URL(location, "https://store.example").pathname
      return path !== "/password"
    } catch {
      return !location.includes("/password")
    }
  }
  if (status === 200 && !/name="password"|enter store password|storefront_password/i.test(body)) {
    return true
  }
  return false
}

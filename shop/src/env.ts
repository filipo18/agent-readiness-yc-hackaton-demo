/** Live dev store. Password-gated; the password is not in this repo. */
export const DEFAULT_SHOP_URL = "https://aiconvertit-demo.myshopify.com"

export function shopUrlFromEnv(): string {
  return (globalThis as any).process.env.SHOP_URL || (globalThis as any).process.env.SHOP_STORE_URL || DEFAULT_SHOP_URL
}

export function storefrontPasswordFromEnv(): string | undefined {
  const value = (globalThis as any).process.env.SHOP_STOREFRONT_PASSWORD?.trim()
  return value ? value : undefined
}

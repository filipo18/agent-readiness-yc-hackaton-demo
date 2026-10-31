# Agent Readiness Test

A hackathon build for YC Haunted Hacks (31 Oct 2026). Paste a store URL. A squad of shopper agents tries to find a product and reach checkout. Each shopper is a [Terse Durable Actor](https://docs.useterse.ai/quickstart). They coordinate on [Agent Relay](https://agentrelay.com/docs/introduction). A report actor scores the store and lists concrete fixes.

The plan, API notes, timeline, and demo script are in [PLAN.md](PLAN.md). `Shopper.shop()` runs the Ghost 18 squad. The dashboard on port 43123 plays that run with no API keys.

## Setup

Requires [Bun](https://bun.sh) 1.4.2 or newer (Terse's requirement).

```sh
curl -fsSL https://bun.sh/install | bash
bun install
cp .env.example .env
bunx terse-cli install
```

`terse actor dev` runs locally without a Terse login. `terse deploy` and `terse auth login` need a browser.

## Commands

```sh
bun run score       # rubric fixture (shipping copy moves the score)
bun run shop:check  # products.json, policy, and password-form parsers
bun run fixer:check # dry-run apply/revert, Admin mutations, client-credentials cache
bun run demo        # SHOP_MODE=fixture, no keys: Ghost 18 squad, score rises
bun run typecheck   # protocol, shop client, actors, relay orchestrator
bun run dashboard   # http://127.0.0.1:43123
# Fixer UI: http://127.0.0.1:43123/fix
```

Actor server, from `actors/` (leave it running):

```sh
terse actor dev
```

In another terminal, after the server says Ready, generate the client the orchestrator will call:

```sh
cd orchestrator
terse actor generate
```

Relay squad (creates a workspace when `RELAY_WORKSPACE_KEY` is empty, and prints the key and a read-only observer token):

```sh
bun run orchestrator
```

## Where to work

| Path | What it is |
| --- | --- |
| [PLAN.md](PLAN.md) | Architecture, rubric, timeline, demo, risks |
| [packages/protocol](packages/protocol) | Finding codes, evidence, deterministic score |
| [fixtures](fixtures) | Before/after evidence for the demo fallback |
| [shop](shop) | Shopify HTTP client, password unlock, Ghost 18 shop loop |
| [actors/src/actor.ts](actors/src/actor.ts) | `Shopper`, `StoreReport`, and `Fixer` |
| [orchestrator](orchestrator) | Run engine, fixer session, optional Agent Relay `#floor` |
| [dashboard](dashboard) | Next.js on port 43123. Fixer is `/fix` |

## Env

See [.env.example](.env.example). The audit path needs no Shopify admin token. Live mode needs `SHOP_URL` (default `https://aiconvertit-demo.myshopify.com`) and `SHOP_STOREFRONT_PASSWORD`. That password is not in the repo. `SHOP_MODE=fixture` needs neither the password nor `OPENAI_API_KEY`. The model only picks a product handle on live runs. The score does not call a model.

## Fix with agent

`/fix` is a `Fixer` durable actor. It reads the store, shows a staged preview, and writes only after Apply. Each write is snapshotted first. **Revert store** sends those original values back, and it is safe to run again. With `RELAY_WORKSPACE_KEY` set, each change is also a `#floor` line. Policy prose uses `OPENAI_API_KEY` when it is set, and a fixed sentence when it is not.

Admin access is the Dev Dashboard client-credentials grant, not a static `shpat_` token:

```sh
curl -sS -X POST "https://aiconvertit-demo.myshopify.com/admin/oauth/access_token" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "grant_type=client_credentials&client_id=$SHOPIFY_CLIENT_ID&client_secret=$SHOPIFY_CLIENT_SECRET"
```

The fixer caches `access_token` in memory and refreshes it 120 seconds before `expires_in` (about 86399). GraphQL is `POST /admin/api/2025-10/graphql.json` with `X-Shopify-Access-Token`. Leave `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` empty to dry-run: the same approve, apply, revert, and shopper rerun, with nothing sent to Shopify.

Exact scopes on that grant: `write_products`, `write_legal_policies`.

| Scope | What it covers |
| --- | --- |
| `write_products` | Read the catalog. `productUpdate` (VIZ title + status `DRAFT`). `productOptionsCreate` / `productOptionUpdate` (Size 8–12 on Ghost 18). `productVariantsBulkUpdate` (keep the listed price). `productSet` (revert Ghost options and variants). `metafieldsSet` / `metafieldsDelete` for `agent_readiness.jsonld`. |
| `write_legal_policies` | Read `shopPolicies`. `shopPolicyUpdate` for `SHIPPING_POLICY` and `REFUND_POLICY`, including the revert of the snapshotted HTML. |

`write_publications` is not used: unpublish is product status `DRAFT`. `write_themes` is not used: Product JSON-LD is a metafield hint. The storefront audit only counts JSON-LD that the theme prints in the HTML, so that finding can stay open after a real apply.

```sh
bun run fixer:check
bun run dashboard
# open http://127.0.0.1:43123/fix
```

`FIXER_ACTOR=on` with `terse actor dev` persists the same session on the Fixer actor. Otherwise the dashboard runs that engine in-process.

Do not commit `.env`. Do not put `TERSE_API_KEY`, `RELAY_WORKSPACE_KEY`, `SHOPIFY_CLIENT_SECRET`, or shopper agent tokens in browser code.

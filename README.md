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
bun run demo        # SHOP_MODE=fixture, no keys: Ghost 18 squad, score rises
bun run typecheck   # protocol, shop client, actors, relay orchestrator
bun run dashboard   # http://127.0.0.1:43123
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
| [actors/src/actor.ts](actors/src/actor.ts) | `Shopper.shop` and `StoreReport` |
| [orchestrator](orchestrator) | Run engine, local relay transcript, optional Agent Relay |
| [dashboard](dashboard) | Next.js on port 43123 |

## Env

See [.env.example](.env.example). The audit path needs no Shopify admin token. Live mode needs `SHOP_URL` (default `https://aiconvertit-demo.myshopify.com`) and `SHOP_STOREFRONT_PASSWORD`. That password is not in the repo. `SHOP_MODE=fixture` needs neither the password nor `OPENAI_API_KEY`. The model only picks a product handle on live runs. The score does not call a model.

Do not commit `.env`. Do not put `TERSE_API_KEY`, `RELAY_WORKSPACE_KEY`, or shopper agent tokens in browser code.

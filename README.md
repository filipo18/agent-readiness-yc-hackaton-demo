# Agent Readiness Test

A hackathon build for YC Haunted Hacks (31 Oct 2026). Paste a store URL. A squad of shopper agents tries to find a product and reach checkout. Each shopper is a [Terse Durable Actor](https://docs.useterse.ai/quickstart). They coordinate on [Agent Relay](https://agentrelay.com/docs/introduction). A report actor scores the store and lists concrete fixes.

The plan, API notes, timeline, and demo script are in [PLAN.md](PLAN.md). This repo is the skeleton, not the finished app. `Shopper.shop()` is intentionally unimplemented.

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
bun run score       # fixture score: shipping fix moves 57 → 73
bun run shop:check  # products.json and policy parsers
bun run typecheck   # protocol, shop client, actors, relay orchestrator
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
| [shop](shop) | Shopify public HTTP client (`/products.json`, policies, cart) |
| [actors/src/actor.ts](actors/src/actor.ts) | `Shopper` and `StoreReport` actors |
| [orchestrator](orchestrator) | Agent Relay workspace, channels, `finding.report` |
| [dashboard](dashboard) | Not scaffolded. Next.js on port 43123. See the plan. |

## Env

See [.env.example](.env.example). The audit path needs no Shopify admin token. `OPENAI_API_KEY` is for prose and ambiguous choices only. The score does not call a model.

Do not commit `.env`. Do not put `TERSE_API_KEY`, `RELAY_WORKSPACE_KEY`, or shopper agent tokens in browser code.

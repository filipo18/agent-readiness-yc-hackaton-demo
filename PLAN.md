# Agent Readiness Test — build plan

Haunted Hacks, 31 Oct 2026, San Francisco. Hacking until 16:00 PT, then a live demo.

Paste a store URL. Five shoppers with different jobs try to find a product and get to checkout without paying. Each shopper is a durable actor (its goal, steps, blockers, and cart survive restarts). They talk on Agent Relay. One report actor is the only writer of the score. The dashboard shows shoppers and Relay messages as they happen.

The demo beat: run the recorded Ghost 18 catalog, show the score and the fixes, change the shipping policy, rerun. `bun run demo` goes from **56 to 72**, and the gift shopper goes from **70 to 100**. VIZ experiment titles and the missing returns policy stay open. `bun run score` is the older rubric fixture (57 to 73) and is not what the dashboard plays.

## What we verified

Checked 31 Oct 2026 against the live docs and the published packages, not memory.

### Terse Durable Actors

Use the **Terse CLI and `terse-sdk`**, not the GitHub README's entrypoint. The two have drifted.

| | Current Terse docs + `terse-sdk@0.14.9` | GitHub `TerseAI/durable-actors` README |
| --- | --- | --- |
| Install | `bunx terse-cli install` then `terse init` | `bunx durable-actors init` |
| Import | `terse-sdk/actor` (re-exports `durable-actors`) | `durable-actors` |
| Entrypoint | `src/actor.ts` | `src/actors.ts` |
| Local server | `terse actor dev` → `http://127.0.0.1:7100/v1/projects/local/actors` | `durable-actors dev` |
| Client | `terse actor generate` (no extra packages; regenerate after API changes) | `durable-actors generate` |

Bun **1.4.2+** is required. Local state is `.durable-actors/`. Deploy is `terse deploy` after `terse auth login` (browser, or `--no-browser`). Secrets: `terse secrets import .env`. Client env: `TERSE_ACTOR_URL`, `TERSE_API_KEY`.

Runtime rules that will bite us:

- An actor runs **one call at a time**, and a call holds the mailbox across `await`. `@Interleave` on `Shopper.shop` is mandatory, or the dashboard freezes while OpenAI or Shopify is in flight. Docs say a long LLM call without it "could be catastrophic."
- Once any method on a class uses `@Interleave`, `this.db.transaction` throws for that class. `Shopper` does not use transactions. `StoreReport` does not use `@Interleave`, so its writes stay serialized. That is the "safe aggregate" the judges asked for.
- `@Persisted` saves on assignment. `this.steps.push(x)` does **not** persist. Reassign: `this.steps = [...this.steps, x]`. Same for findings.
- `@Emittable` on a `@Persisted` field sends `state` on connect and `state_update` after a successful call. The dashboard should use this, not polling.
- `@Ephemeral` dies when the actor sleeps. Default idle timeout is **10 seconds**. `@Compute({ idleTimeoutMs: 60_000, memoryMiB: 512 })` on `Shopper`. Open WebSockets keep the gateway connection but the actor can still be evicted; the next message wakes it from SQLite.
- **One alarm per actor.** `this.alarm.set(timestamp)` replaces the previous one and fires `onAlarm` even if the actor is dormant. Use it as a stall watchdog, not as a cron.
- Each actor has `this.db` (SQLite). We do not need it for the MVP. The report fits in persisted fields.
- `@Resource` can tie a sandbox to the actor (`onResume`, `onGracefulShutdown`). That is the hook for a Superserve desktop later. Not in the MVP.
- WebSocket auth: backend calls `prepareWebsocket({ actorId, metadata })`, browser opens `websocketUrl` before `connectByMs`. Do this in a route handler so the Terse key stays on the server.
- Actor ids are global per class. Use a new id per run: `report:{runId}`, `shopper:{runId}:{persona}`.

**Uncertain:** whether a Terse sandbox allows a long-lived Relay WebSocket. Do not depend on it. The shopper posts to Relay with a short HTTP call, or the orchestrator posts for it. The long-lived listener stays in the orchestrator process.

### Agent Relay

Two documents disagree. The rendered "TypeScript SDK" page (`/docs/typescript-sdk`, labeled v15.0.1) describes `spawnAgent({ cli: "claude" | "codex" })` and a local broker. The **published package `@agent-relay/sdk@15.0.1` does not export `spawnAgent`.** Its types export `AgentRelay.createWorkspace`, `relay.workspace.register`, `sendMessage({ to: "#floor" })`, `registerAction({ input: zod, handler })`, and `addListener`. That matches the Relaycast API page and the MCP page, not the spawn page.

**Build against the package and the Relaycast HTTP API.** Do not spawn Claude Code or Codex. Our shoppers are our actors. [orchestrator/src/relay.ts](orchestrator/src/relay.ts) typechecks against `@agent-relay/sdk@15.0.1`.

Package surface we will use:

```ts
const relay = await AgentRelay.createWorkspace({ name: "agent-readiness" })
// or: new AgentRelay({ workspaceKey, baseUrl })

const coordinator = await relay.workspace.register({ name: "coordinator", type: "agent" })
await coordinator.channels.create({ name: "floor", topic: "..." })
await shopper.channels.join("floor")
await shopper.sendMessage({ to: "#floor", text, idempotencyKey })

const handle = relay.registerAction({
  name: "finding.report",
  input: FindingReport, // zod
  availableTo: ["bargain", "gift", "spec", "impatient", "returns"],
  handler: async ({ input, agent }) => ({ accepted: true }),
})
relay.addListener(handle.completed(), (event) => event.output)
relay.addListener("message.created", (event) => event.message.text)
```

Facts from the package and the Relaycast doc:

- Actions are **fire-and-forget**. Invoke returns an acknowledgement (`invocationId`), not the handler result. The handler runs in the process that called `registerAction` (our orchestrator). Results show up as `action.completed` / `action.failed`. Message the caller from the handler if it needs data back.
- `RelayAgentClient` (what `workspace.register` returns) has `sendMessage`, `channels`, `reply`, `react`. It does **not** have `commands.invoke`. Invoke is on an agent-scoped messaging client: `commands.invoke(name, input)`, and it requires that agent connection. First hour: confirm a shopper token can invoke `finding.report` and that `agent.name` in the handler is the shopper.
- Registration is create-only. A duplicate name is HTTP 409 `name_conflict`. Persist the agent token and `reconnect({ apiToken })` to resume. Losing the token means rotate, which retires the old one.
- Messages: `#channel`, `@handle`, or `['@a','@b']` for a group DM. `mode: "wait"` queues; `mode: "steer"` asks to interrupt. `idempotencyKey` maps to the `Idempotency-Key` header.
- Deliveries have ack / fail / defer. We do not need a custom delivery adapter for the demo. The durable part judges can see is: messages survive in the workspace, and the observer stream resumes from `sinceSeq`.
- Dashboard auth is an **observer token**, minted with `createObserverToken({ workspaceKey, name, filters })`. Prefix in the SDK comments is `ot_live_`. It is read-only. `GET /v1/ws?token=` is the stream. The workspace key is rejected on that socket. Scopes include `stream:read`. Never give the browser the workspace key.
- Hosted bases, and they disagree: the SDK's observer default is `https://cast.agentrelay.com`. The Relaycast doc says the engine is `https://armadillo.agentrelay.com/v1`, and that `rk_*` keys stay on `cast.agentrelay.com`. Token prefixes in the doc are `ar_ws_*` / `rk_live_*` (workspace), `ar_ag_*` / `at_live_*` (agent), `ot_live_*` (observer). **First hour: create a workspace with no `baseUrl`, print the key prefix, and only set `RELAY_BASE_URL` if the default host rejects it.**
- Self-host fallback: `@relaycast/engine` (npm 12.3.0) on port **8787**, `RELAY_BASE_URL=http://127.0.0.1:8787`. Same API.
- CLI `npx -y agent-relay@next init` starts a local server for Claude Code / Codex sessions. That is a different entrypoint. Use it only as a last-ditch way to show two named agents talking if the SDK cannot reach Relaycast. Do not build the product on it.

### How shoppers browse

**Recommendation: Shopify's public Online Store HTTP, not a browser.** Confirmed today: `GET https://www.kyliecosmetics.com/products.json?limit=1` returned **200** and a real product list. `https://bombas.com/products.json` returned **429**. `https://mock.shop/products.json` returned **404**.

`mock.shop` in Oct 2026 is an auth-free **Storefront GraphQL** directory (`https://{catalog}.mock.shop/api`, no key). Those hosts do not serve `/products.json` or `/cart.js`. Use mock.shop only to browse sample catalogs while the test store is being created. Do not demo the buy path against it.

Use this order. Stop at the first one that works on **our** store, in the first 15 minutes:

1. **Online Store Ajax (MVP).** No admin token.
   - `GET /products.json?limit=250&page=1`
   - `GET /search/suggest.json?q=ghost&resources[type]=product&resources[limit]=8`
   - `GET /products/{handle}` for JSON-LD (`"@type":"Product"`)
   - `GET /robots.txt`
   - `GET /policies/shipping-policy` and `/policies/refund-policy` (strip tags; do not trust a screenshot)
   - `GET /cart.js` then `POST /cart/add.js` with `{"items":[{"id": variantId, "quantity": 1}]}` and the cookie jar
   - `GET /cart/{variantId}:1` and follow redirects. Reaching a URL that contains `checkout` counts as checkout. Stop before payment.
2. **Fixtures.** `SHOP_MODE=fixture` and `SHOP_FIXTURE=before|after`. This is the demo fallback, already scored.
3. **Storefront GraphQL** only if `/products.json` 404s on our store. That needs a Storefront public token from the admin, or a mock.shop `storefrontApiUrl`. Cart and checkout then differ. Budget this only if step 1 fails.

A headless browser is the wrong critical path for a five-hour demo. Shopify checkout bot-walls, and standing up Chrome is a project of its own. The client in [shop/src/shopify.ts](shop/src/shopify.ts) already does the public fetches, the cookie jar, and the policy detectors.

### Freestyle and Superserve

**Superserve is useful. Freestyle is not, today.**

Superserve (`@superserve/sdk@0.11.5`) is Firecracker microVMs. The relevant product is computer use:

```ts
const sandbox = await Sandbox.create({ name: "shopper", fromTemplate: "superserve/desktop" })
const shot = await sandbox.desktop.screenshot()
await sandbox.desktop.step(actions, { waitForChange: true, format: "jpeg" })
const viewer = await sandbox.desktop.getStreamUrl({ viewOnly: true })
```

`superserve/desktop` ships xfce, Chrome, and a browser viewer on port 6080. Pause/resume keeps the desktop. There is also `commands.run` for shell. Env: `SUPERSERVE_API_KEY`. Stretch only: one impatient shopper's checkout, with the viewer embedded in the dashboard, sandbox id stored via a Terse `@Resource`. Do not start this until the HTTP path and the rerun are green.

Freestyle (`freestyle@0.2.21`, `FREESTYLE_API_KEY`) is full Linux VMs: fast boot, hibernate, snapshots. The Chromium guide is real (Debian Chromium, systemd, CDP, nginx proxy, Playwright `connectOverCDP`, noVNC). It also has a JS execute API (`POST /execute/v3/script`). Building that browser snapshot is most of the afternoon. Say we evaluated it and chose Superserve's desktop template for a live view, and the public Shopify JSON for the score. Do not install Chromium on a Freestyle VM during the event.

**Mastra:** skip. It would be a second agent runtime next to actors and Relay. If a sponsor asks, the answer is that the actors and the relay already are the runtime.

## Architecture

```mermaid
flowchart TB
  subgraph browser [Dashboard Next.js :43123]
    UI[Score, shopper cards, transcript]
  end
  subgraph orch [Orchestrator Bun process]
    RelaySDK["@agent-relay/sdk listener and finding.report handler"]
  end
  subgraph terse [Terse local :7100]
    Bargain[Shopper bargain]
    Gift[Shopper gift]
    Spec[Shopper spec]
    Impatient[Shopper impatient]
    Returns[Shopper returns]
    Report[StoreReport serialized writer]
  end
  subgraph relay [Agent Relay workspace]
    Floor["#floor"]
    Findings["#findings"]
    Action["action finding.report"]
  end
  Store[Shopify Online Store public HTTP]
  Fix[fixtures or SHOP_MODE]

  UI -->|prepareWebsocket grants| Bargain
  UI -->|prepareWebsocket grants| Report
  UI -->|observer token stream| Floor
  RelaySDK -->|generated client submitMission| Report
  Bargain -->|@Interleave shop| Store
  Bargain -.->|if live HTTP fails| Fix
  Bargain -->|sendMessage| Floor
  Bargain -->|JSON message or invoke| Findings
  Findings --> Action
  Action -->|handler in orchestrator| RelaySDK
  Gift --> Store
  Spec --> Store
  Impatient --> Store
  Returns --> Store
```

The orchestrator is a normal Bun process, not an actor. It owns the Relay WebSocket and the action handlers. Actors own shopper state and the score. The browser never holds a workspace key or a Terse admin key.

## Components

| Piece | Owner | Role |
| --- | --- | --- |
| `packages/protocol` | A | Finding codes, evidence shape, `scoreStore`. Already implemented. |
| `shop` | A | Public Shopify reads and `POST /cart/add.js`. Parser is in. Persona choice is not. |
| `actors` `Shopper` | A | One class, five ids. Goal, steps, cart, blockers. `@Interleave shop`. |
| `actors` `StoreReport` | A | Merges mission evidence and rescores. Already calls `scoreStore`. |
| `orchestrator` | B | Creates the workspace, channels, action, observer token. |
| `dashboard` | B | Next.js. Not scaffolded. |
| Test store | Filip | `https://aiconvertit-demo.myshopify.com`. Password stays on. Unlock with `SHOP_STOREFRONT_PASSWORD`. |

If there are two people, C's store work sits with B until noon, then with A.

## Actor data

### Shopper

Id: `shopper:{runId}:{persona}`.

| Field | Decorators | Contents |
| --- | --- | --- |
| `view` | `@Persisted @Emittable` | `persona`, `status` (`idle\|running\|blocked\|done\|error`), `goal`, `step`, `stepsDone`, `cartVariantId`, `missionScore`, `blockerCodes` |
| `runId`, `storeUrl` | `@Persisted` private | Set in `assign` |
| `relayToken` | `@Persisted` private | **Not emittable.** A dashboard socket would otherwise see it. |
| `steps` | `@Persisted` private | Reassigned string log |

Methods: `assign`, `shop` (`@Interleave`), `noteStep`, `onAlarm` (if `status === "running"`, mark `blocked` and append `STALL`). `STALL` is operational. It is not a store finding.

`@Compute({ cpu: 0.5, memoryMiB: 512, idleTimeoutMs: 60_000 })`.

Alarm: at the start of each step, `this.alarm.set(Date.now() + 90_000)`. One alarm, so each step replaces the last.

### StoreReport

Id: `report:{runId}`. No `@Interleave`.

| Field | Decorators | Contents |
| --- | --- | --- |
| `report` | `@Persisted @Emittable` | `runId`, `storeUrl`, `total`, `status` (`collecting\|final`), `findings`, `categories`, `missions` |
| `evidence` | `@Persisted` private | Full `StoreEvidence`. Missions replaced per persona. |

Methods already stubbed: `open` (storefront facts, no missions), `submitMission` (replace that persona, rescore), `finalize`.

Shoppers do not write `report`. They return evidence or post a finding. The orchestrator calls `submitMission`. Concurrent shoppers are safe because the mailbox runs one `submitMission` at a time.

### Run

Not an actor. A `runId` is a short id (`crypto.randomUUID()` sliced). New run, new actor ids. Do not reset a previous run's actor during the demo or the "before" state is gone if the rerun crashes. Keep both.

## Relay

Workspace name: `agent-readiness-{time}`.

Agents: `coordinator` (type `agent`), plus one agent per persona (`bargain`, `gift`, `spec`, `impatient`, `returns`).

### Channels

| Channel | Who speaks | What |
| --- | --- | --- |
| `#floor` | everyone | Human-readable status and tips. This is the column judges watch. |
| `#findings` | shoppers | One JSON message per finding, body is `FindingReport`. |

DMs: a shopper may DM `@coordinator` if it is blocked and wants a decision (`mode: "steer"` for "password wall, abort"). Do not put the score on a DM. The score is the report actor.

Group DM: not in the MVP.

### Message shapes

`#floor` text, plus `idempotencyKey`:

```text
bargain: Skip 23 titles that start with VIZ. Those are A/B rows.
gift: Shipping policy: "We ship worldwide." No price, no day count.
```

`#findings` text is JSON:

```json
{ "runId": "ab12", "persona": "gift", "code": "SHIPPING_ETA_MISSING", "summary": "No delivery window is stated before checkout." }
```

`idempotencyKey`: `{runId}:{persona}:{code}`.

Reactions: coordinator adds `:eyes:` on a finding it has written to the report actor. Optional, nice on the dashboard.

### Typed action

`finding.report` — zod object in [orchestrator/src/relay.ts](orchestrator/src/relay.ts):

```ts
{ runId: string, persona: PersonaId, code: string, summary: string }
```

- Registered on the orchestrator's `AgentRelay`, `availableTo` the five shoppers.
- Handler writes through the generated Terse client into `StoreReport`. Keep the handler under a second. No model call inside it.
- `handle.failed()` logs to the console and to `#floor`.
- MVP path if `commands.invoke` is awkward: shopper `sendMessage` to `#findings`, and the `message.created` listener (already in `relay.ts`) parses the JSON and calls the same function. Do **one** of invoke or message per finding, or the handler runs twice. `submitMission` is safe to repeat for the same persona. A raw finding log is not, until you dedupe on `runId+persona+code`.

Second action, only if the first is dull in the demo: `run.complete` with `{ runId, persona, missionScore }`. Not required. `finalize()` on the report actor is the end of the run.

## Personas

All five share `Shopper`. The goal config is `PERSONAS` in [packages/protocol/src/evidence.ts](packages/protocol/src/evidence.ts).

| Id | Job | Done when |
| --- | --- | --- |
| `bargain` | Cheapest real Ghost 18, skip VIZ titles | Carts the cheapest non-VIZ Ghost 18 |
| `gift` | Ghost 18 as a gift, here within 5 days | Shipping policy states a price or "free" **and** a day window |
| `spec` | Ghost 18 in men's size 10 | A Size option contains `10`, then cart add |
| `impatient` | Any real shoe in ≤ 4 steps | VIZ rows push the path past 4 steps |
| `returns` | Read the refund policy, buy only if it states a window in days | `refundWindowDays != null`. Otherwise abandon without carting |

No OpenAI call is required to satisfy these. Use the model only when several variants tie, and for a one-sentence paraphrase under the deterministic fix. If the key fails, show `FIX_COPY` from [packages/protocol/src/findings.ts](packages/protocol/src/findings.ts).

## Scoring

`scoreStore` is the rubric. Do not reimplement it in the dashboard or in a prompt.

Weights (sum 100):

| Category | Weight | How it scores |
| --- | --- | --- |
| Discoverability | 15 | products.json 45, search 20, Product JSON-LD 20, robots not blocking agents 15 |
| Catalog clarity | 15 | If there are products: 60 × priced ratio + 40 × imaged ratio |
| Variant and spec fit | 20 | Share of missions whose constraint is met (color in text, size option, ETA, returns window, or step cap) |
| Cart | 15 | Share of matched missions that got `cart/add.js` ok |
| Shipping before checkout | 15 | Price and ETA 100, price only 70, vague text 20, nothing 0 |
| Return policy | 10 | Shipping-policy text 20, refund text 40, a day count 40 |
| Checkout reach | 10 | Reached checkout 100, bot wall 40, attempted and failed 0. Not attempted stays 0 |

Password wall or unreachable store: total **0**, one blocker finding.

Mission score (the card, not the big number): 40 match + 30 cart + 30 for that persona's constraint. Abandoned caps at 40. Returns without a window caps at 40.

Fixture result, already checked in:

| | Store score | Gift mission | Findings cleared | Still open |
| --- | --- | --- | --- | --- |
| Before | 57 | 70 | | Shipping price, shipping ETA, color not in text, returns policy missing, no JSON-LD |
| After one policy edit | 73 | 100 | Both shipping findings | Returns, JSON-LD |

The dashboard plays a different fixture: the recorded Ghost 18 catalog (`bun run demo`). That one moves **56 → 72**, gift **70 → 100**, and keeps the VIZ title finding.

That is the demo. Do not "fix" color and returns in the same edit or there is nothing left to talk about.

## Test store

Live target: `https://aiconvertit-demo.myshopify.com` (`SHOP_URL`). About 24 products, including **Brooks Men's Ghost 18 Running Shoes** and many **VIZ V…** A/B rows. The storefront password cannot be turned off. The password is not in this repo.

Unlock, then keep the cookies:

```sh
# GET /password first (session cookie + authenticity token)
curl -c /tmp/shop.ck -b /tmp/shop.ck -sS "https://aiconvertit-demo.myshopify.com/password" -o /tmp/pw.html
# POST form_type=storefront_password, utf8=✓, password=$SHOP_STOREFRONT_PASSWORD
# Expect 302. Then:
curl -c /tmp/shop.ck -b /tmp/shop.ck -sS "https://aiconvertit-demo.myshopify.com/products.json?limit=5"
```

The shop client does that itself when `SHOP_STOREFRONT_PASSWORD` is set. Without it, live mode stops and says so. `SHOP_MODE=fixture` does not call the store.

Personas on this catalog:

- **bargain** buys the cheapest real Ghost 18 and skips VIZ titles.
- **spec** wants Ghost 18 in men's size 10 as a variant.
- **gift** will not promise Friday unless the shipping policy states a price and a day count.
- **impatient** has to wade through VIZ rows, so the path is longer than four steps.
- **returns** will not cart shoes unless the refund policy states a window in days.

The recorded fixture is 1 Ghost 18 (sizes 8–12) plus 23 `VIZ Vn` rows, vague shipping copy, and no refund policy. The shipping-policy edit is still the on-stage fix. VIZ titles and the missing returns window stay open.

Live fix, in the Shopify admin: replace the shipping policy with:

```text
Flat rate $6. Free shipping over $75. Arrives in 3–5 business days.
```

Rerun. Shipping findings clear. The gift mission rises. VIZ titles and returns stay.

## Stack

TypeScript, Bun, Terse, Agent Relay SDK, Zod. Dashboard: Next.js + Tailwind + shadcn/ui, port **43123**.

OpenAI: `OPENAI_MODEL` default `gpt-4.1-mini`. Structured output, one call per shopper only on a tie, one call at the end to paraphrase fixes. Temperature 0. Never let the model pick the score.

Supabase, stretch, for the "millions of audits" prize. Table `audits (id, store_url, run_id, score, findings jsonb, created_at)`. The hot path stays in actors. The row is written once in `finalize`. Service role key on the server only. If there is no Supabase project by 15:00, skip it. The demo does not need it.

## Dashboard

Scaffold with `create-next-app` into a temp dir, then move it to `dashboard/`. App Router. shadcn: button, input, card, badge, scroll-area, separator.

Layout, desktop: three columns.

- Left, 280px: URL input, Run, mode toggle Live / Fixture, persona rows. Each row is the shopper's emittable `view`: status badge, last step, mission score.
- Center: the number, seven category bars, finding list. Each finding shows severity, summary, fix, and which personas hit it. Empty state: "Paste a public Shopify store. The squad shops it. Nobody pays." Loading: cards in `idle` / `running`. Error: actor or relay unreachable, with a button that runs the before fixture.
- Right, 360px: `#floor` and `#findings` transcript, newest at the bottom, persona name colored per shopper.

Mobile: score, then shoppers, then transcript. The URL form stays on top.

Connect:

- `POST /api/runs` starts a run (audit storefront, `StoreReport.open`, `Shopper.assign`, `Shopper.shop` without awaiting all five in one request — fire them and return the run id).
- `GET /api/runs/:id/sockets` returns WebSocket grants for the report and the five shoppers.
- `GET /api/runs/:id/relay` is a server-sent stream of observer events. The browser does not open Relay itself unless the observer token is scoped and you accept it in the client. Prefer the SSE proxy so the token stays server-side.

Show `state` and `state_update` from Terse. Ignore nothing else on the socket; a `log` broadcast can append to the shopper's step line.

## Timeline

Solo. All times PT. The fixture path (shop loop, local `#floor` / `#findings`, dashboard on port 43123) is the rehearsal and does not need keys. Freeze at 15:40.

### Done by noon

Plan, rubric, shop client with the password unlock, five Ghost 18 personas, fixture run, dashboard.

### 12:00–13:00 — one live pass

Copy `SHOP_STOREFRONT_PASSWORD` into `.env`. `SHOP_MODE=live`. Confirm `/products.json` returns the Ghost 18 and the VIZ rows after unlock. Run the dashboard's **Run live store** once. If size options are not literally `10`, adjust `SPEC_SIZE` matching in `shop/src/catalog.ts` to the real option text. Do not debug Relay or Terse deploy in this hour.

### 13:00–14:15 — make the live findings true

Read the real shipping policy, refund policy, and a Ghost variant. If the theme already states a delivery window, the shipping finding will not fire. Pick the defect that is actually there (VIZ titles are the likely one) and make that the on-stage edit. Keep one defect unfixed so the rerun is not a perfect score.

### 14:15–15:15 — the rerun, then keys if it is boring

Edit the shipping policy (or the one real defect). Rerun live. Score moves. Then, only if that is solid: set `OPENAI_API_KEY` and confirm live shoppers still cannot change the score with a hallucination. Set `RELAY_WORKSPACE_KEY` if you want the transcript badge to say Agent Relay. `terse actor dev` is optional. The dashboard already runs the same `shopPersona` and `ReportJournal` the actor calls.

### 15:15–15:40 — one stretch, or nothing

Supabase insert on finalize, or a Superserve screenshot of checkout. Not both. Not Freestyle.

### 15:40–16:00 — freeze

Rehearse twice on the demo machine. `.env` has the storefront password. Admin tab open to the policy you will edit. Dashboard on port 43123. If live Shopify fails on stage, use **Run recorded store** then **Run after shipping fix**.

## MVP vs stretch

**MVP (must be on stage):**

- Fixture and live modes.
- Five shoppers if the class is generic; if it is not, ship `bargain`, `gift`, and `returns`. Those three carry the story.
- Report actor score and findings.
- `#floor` visible in the dashboard.
- `finding.report` registered, even if the listener is what actually records.
- Shipping-policy edit, rerun, score up.

**Stretch:** Supabase audit log, Superserve viewer, deployed Terse actors, OpenAI paraphrase, checkout bot-wall polish, JSON-LD as a second fix.

**Out:** payment, accounts, Freestyle Chromium, Mastra, a generic crawler for non-Shopify stores, multi-store queues.

## Risks

| Risk | What we do |
| --- | --- |
| Relay docs spawn page ≠ npm package | Already decided: SDK 15.0.1 workspace API. Do not re-litigate at 14:00. |
| `createWorkspace` hits the wrong host | Try default, then `https://armadillo.agentrelay.com`, then `@relaycast/engine` on 8787. The message shapes stay the same. |
| Terse login or deploy fails | Stay on `terse actor dev`. Judges are in the room. |
| Actor sandbox cannot reach Relay | Orchestrator posts the `#floor` lines on the shopper's behalf using that agent's token. The actor still holds the cart and the steps. |
| Dev store password | `SHOP_STOREFRONT_PASSWORD` unlocks it (GET `/password`, POST the form, keep cookies). Missing or wrong password stops live mode. Fixture mode does not need it. |
| 429 from Shopify | Cache the first successful responses and replay them. One shopper fetches the catalog; the others read the actor or a file. Do not fan out five full crawls. |
| Checkout bot wall | The category is only 10 points. Cart add is the buy. Record `CHECKOUT_BOT_WALL` and move on. |
| LLM hangs or invents a score | Score function never calls a model. 12s timeout on Shopify, 20s on the model, then use `FIX_COPY`. |
| `@Interleave` left off | Dashboard looks frozen. It is the first bug to check. |
| Array push "lost" steps | Reassign. There is a comment on the actor. |
| Double finding from message + invoke | One path only. |
| Observer token in the client bundle | SSE proxy. |
| Supabase not linked | Skip. Mention the table in the pitch without showing a broken panel. |
| Someone starts a Freestyle Chromium build | Stop. It will eat the rerun. |

## Demo script (about 2 minutes 30 seconds)

Have the admin shipping-policy page open in another tab before you walk up. Actors and Next already running. Start on the empty dashboard.

1. **0:00** "Stores are about to get shopped by agents. Most of them fail in ways a human theme never shows. This runs five shoppers against the store and writes the fixes."
2. **0:15** Paste the store URL. Hit Run. Point at cards waking: bargain, gift, spec, impatient, returns. "Each one is a durable actor. That card is its persisted state."
3. **0:35** Point at the transcript. "They're on Agent Relay. Gift just said shipping is 'we ship worldwide' — no price, no day count. Bargain can't see blue unless it's in the title or a Color option."
4. **1:05** Score lands. "56. The number is deterministic. The model does not grade the store." Read three fixes: disclose shipping before checkout, stop publishing VIZ experiment titles, publish a returns window.
5. **1:25** Switch to Shopify admin. Replace the shipping policy with the flat-rate sentence. Say what you are typing.
6. **1:45** Run again. New run id. "Same actors pattern, fresh ids, so the first run is still there."
7. **2:10** Score 72. Gift 100. Shipping findings gone. "The VIZ titles and the missing returns window are still there. That's the next edit."
8. **2:25** Stop. One sentence from the prize lines below. Do not open the code unless a judge asks.

If live Shopify fails while you are on stage: toggle Fixture, say "this is the recorded store, same rubric," and still do before → after. Do not debug on stage.

## Prize lines

**Overall / YC interview.** "Agent shopping is a new channel, and stores are blind on it. We sell the score and the patch list to every Shopify merchant. The wedge is the audit; the company is the continuous suite of shoppers that re-run when the catalog changes."

**Best Durable Actors.** "Every shopper is an actor with its own cart and step log. The report actor is the only writer of the score, so five shoppers can finish together without losing findings. `@Emittable` is the dashboard. If a shopper stalls, the alarm wakes that same id and the steps are still in SQLite."

**Best Agent Relay.** "Shoppers don't share memory. They post blockers to `#findings` and status to `#floor`. `finding.report` is a Zod action; the handler is what is allowed to touch the report actor. The room watches a read-only observer stream, not our logs."

**Supabase, most likely to scale.** "Actors are the hot coordination for one audit. The thing that grows to millions is the append-only audit log: one row per run, findings as JSON, a merchant reads their own rows. We do not put the cart in Postgres." If the insert did not ship, say "the row is the next hour; the actor is the source of truth today."

**OpenAI credits.** "The model breaks ties and writes the sentence under a fix. It does not assign points. A rerun after a one-line policy edit has to move the score for a reason a judge can check."

**Freestyle / Superserve.** "Browsing the catalog does not need a browser. Superserve's desktop template is there when checkout is a real Chrome session we want on the projector. Freestyle VMs are how we'd snapshot that browser for a fleet. We did not spend the afternoon building the snapshot."

## First bugs to expect

- Generated client is stale after an actor method rename. Regenerate.
- `terse actor generate` must be run while `terse actor dev` is up.
- Workspace 409 on the second orchestrator start: set `RELAY_WORKSPACE_KEY` or change the name. Agent names also 409. Persist tokens.
- Dashboard works in fixture mode and dies in live mode: almost always the password page or a missing cookie on `cart/add.js`.

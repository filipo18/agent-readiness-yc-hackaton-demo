# Dashboard

Not scaffolded yet. Build this in the first hour so the actors have a place to show up.

- Next.js, TypeScript, Tailwind, shadcn/ui.
- Dev server on port **43123** (`next dev -p 43123`).
- Do not put `TERSE_API_KEY`, the Relay workspace key, or shopper agent tokens in client code.
- The browser gets a Terse WebSocket grant from a route handler (`actors.Shopper.prepareWebsocket`, `actors.StoreReport.prepareWebsocket`).
- The browser gets Relay events from a route that holds `RELAY_OBSERVER_TOKEN` and streams `message.created`. The observer token is read-only. Never send the workspace key to the browser.

Screens are specified in [PLAN.md](../PLAN.md).

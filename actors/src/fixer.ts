import { Actor, Compute, Emittable, Interleave, Persisted, type ActorSocket } from "terse-sdk/actor"
import { FixerEngine } from "@readiness/shop"

// Public actor types stay local plain JSON so the dts compiler never walks shop/src.
type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
type FindingInput = { [k: string]: Json }
type RelayMessageInput = { [k: string]: Json }
type FixerBlob = { [k: string]: Json }
type FixerView = { [k: string]: Json }

type Watcher = { watcher: string }
type Incoming = { type: "ping" }
type Outgoing = { type: "log"; line: string }
type Socket = ActorSocket<Watcher, Outgoing>

const empty: FixerView = {
  sessionId: "",
  storeUrl: "",
  shop: "",
  dryRun: true,
  phase: "draft",
  steps: [],
  proposals: [],
  floor: [],
  scoreBefore: 0,
  scoreAfter: null,
  findings: [],
  product: null,
  error: null,
  canRevert: false,
  writesToShopify: false,
}

/**
 * One fixer for one audit. The baseline catalog is persisted, so a restart
 * can still revert the writes from this id. `@Interleave` keeps the mailbox
 * free during Admin API and model calls.
 */
@Compute({ cpu: 0.5, memoryMiB: 512, idleTimeoutMs: 60_000 })
export class Fixer extends Actor<Watcher, Incoming, Outgoing> {
  @Persisted @Emittable view: FixerView = empty
  @Persisted private blob: FixerBlob | null = null

  @Interleave
  async open(input: { storeUrl?: string; sessionId?: string; findings?: FindingInput[]; relayMessages?: RelayMessageInput[] } = {}): Promise<FixerView> {
    return commitTo(this, await FixerEngine.open(input as any))
  }

  async approve(id: string, approved: boolean): Promise<FixerView> {
    const engine = hydrate(this)
    engine.approve(id, approved)
    return commitTo(this, engine)
  }

  @Interleave
  async apply(): Promise<FixerView> {
    const engine = hydrate(this)
    await engine.apply()
    return commitTo(this, engine)
  }

  @Interleave
  async revert(): Promise<FixerView> {
    const engine = hydrate(this)
    await engine.revert()
    return commitTo(this, engine)
  }

  @Interleave
  async rerun(): Promise<FixerView> {
    const engine = hydrate(this)
    await engine.rerun()
    return commitTo(this, engine)
  }

  async current(): Promise<FixerView> {
    return this.view
  }

  async onConnect(socket: Socket): Promise<void> {
    const line = (this.view.floor as string[] | undefined)?.at(-1)
    if (line) socket.send({ type: "log", line })
  }

}

function hydrate(self: any): FixerEngine {
  if (!self.blob) throw new Error("Fixer is not open")
  return FixerEngine.hydrate(self.blob)
}

function commitTo(self: any, engine: FixerEngine): FixerView {
  self.blob = engine.serialize() as unknown as FixerBlob
  self.view = engine.view() as unknown as FixerView
  const line = (self.view.floor as string[] | undefined)?.at(-1)
  if (line) self.broadcast({ type: "log", line })
  return self.view
}

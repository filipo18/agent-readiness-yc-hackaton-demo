import { Actor, Compute, Emittable, Interleave, Persisted, type ActorSocket } from "terse-sdk/actor"
import {
  FixerEngine,
  type FindingInput,
  type FixerBlob,
  type FixerView,
  type RelayMessageInput,
} from "@readiness/shop"

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
    return this.commit(await FixerEngine.open(input))
  }

  async approve(id: string, approved: boolean): Promise<FixerView> {
    const engine = this.engine()
    engine.approve(id, approved)
    return this.commit(engine)
  }

  @Interleave
  async apply(): Promise<FixerView> {
    const engine = this.engine()
    await engine.apply()
    return this.commit(engine)
  }

  @Interleave
  async revert(): Promise<FixerView> {
    const engine = this.engine()
    await engine.revert()
    return this.commit(engine)
  }

  @Interleave
  async rerun(): Promise<FixerView> {
    const engine = this.engine()
    await engine.rerun()
    return this.commit(engine)
  }

  async current(): Promise<FixerView> {
    return this.view
  }

  async onConnect(socket: Socket): Promise<void> {
    const line = this.view.floor.at(-1)
    if (line) socket.send({ type: "log", line })
  }

  private engine(): FixerEngine {
    if (!this.blob) throw new Error("Fixer is not open")
    return FixerEngine.hydrate(this.blob)
  }

  private commit(engine: FixerEngine): FixerView {
    this.blob = engine.serialize()
    this.view = engine.view()
    const line = this.view.floor.at(-1)
    if (line) this.broadcast({ type: "log", line })
    return this.view
  }
}

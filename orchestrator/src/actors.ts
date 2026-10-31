import { PERSONA_IDS, type MissionEvidence, type PersonaId, type ReportView, type ShopperView } from "@readiness/protocol"
import { actors } from "./generated/index.js"

export const actorsEnabled = () => process.env.ACTORS !== "off"

export function shopperId(runId: string, persona: PersonaId) {
  return `${runId}.${persona}`
}

export type ActorTick =
  | { kind: "view"; persona: PersonaId; view: ShopperView; newSteps: string[] }
  | { kind: "mission"; persona: PersonaId; mission: MissionEvidence; report: ReportView; view: ShopperView; newSteps: string[] }
  | { kind: "failed"; persona: PersonaId; message: string }

/** Each persona is its own Shopper actor. StoreReport is the only score writer. */
export async function* driveShoppers(
  runId: string,
  storeUrl: string,
  storefront: Parameters<actors.StoreReport.Stub["open"]>[2],
  password?: string,
): AsyncGenerator<ActorTick | { kind: "report"; report: ReportView }> {
  const report = actors.StoreReport.get(runId)
  yield { kind: "report", report: await report.open(runId, storeUrl, storefront) }

  const seen = new Map<PersonaId, number>()
  const pending = new Map<PersonaId, Promise<{ persona: PersonaId; mission?: MissionEvidence; error?: string }>>()
  for (const persona of PERSONA_IDS) {
    const stub = actors.Shopper.get(shopperId(runId, persona))
    await stub.assign({ runId, persona, storeUrl, relayToken: "" })
    seen.set(persona, 0)
    pending.set(
      persona,
      stub.shop(password ?? null).then(
        (mission) => ({ persona, mission }),
        (error) => ({ persona, error: error instanceof Error ? error.message : String(error) }),
      ),
    )
  }

  const pull = async (persona: PersonaId) => {
    const state = await actors.Shopper.get(shopperId(runId, persona)).state()
    const from = seen.get(persona) ?? 0
    seen.set(persona, state.steps.length)
    return { view: state.view, newSteps: state.steps.slice(from) }
  }

  while (pending.size > 0) {
    const tick = new Promise<"tick">((r) => setTimeout(() => r("tick"), 1500))
    const winner = await Promise.race([tick, ...pending.values()])
    if (winner === "tick") {
      for (const persona of pending.keys()) {
        const { view, newSteps } = await pull(persona)
        if (newSteps.length) yield { kind: "view", persona, view, newSteps }
      }
      continue
    }
    pending.delete(winner.persona)
    if (!winner.mission) {
      yield { kind: "failed", persona: winner.persona, message: winner.error ?? "shop failed" }
      continue
    }
    const { view, newSteps } = await pull(winner.persona)
    const submitted = await report.submitMission(winner.mission)
    yield { kind: "mission", persona: winner.persona, mission: winner.mission, report: submitted, view, newSteps }
  }
  yield { kind: "report", report: await report.finalize() }
}

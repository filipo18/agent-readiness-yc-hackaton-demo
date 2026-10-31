import { runAudit, type RunEvent, type RunRequest } from "@readiness/orchestrator"

export interface Session {
  id: string
  events: RunEvent[]
  done: boolean
  error?: string
  listeners: Set<() => void>
}

const globalSessions = globalThis as typeof globalThis & { __readinessSessions?: Map<string, Session> }
const sessions = (globalSessions.__readinessSessions ??= new Map<string, Session>())

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function startSession(request: RunRequest): Session {
  const session: Session = {
    id: crypto.randomUUID().slice(0, 8),
    events: [],
    done: false,
    listeners: new Set(),
  }
  sessions.set(session.id, session)
  void pump(session, request)
  return session
}

async function pump(session: Session, request: RunRequest): Promise<void> {
  try {
    for await (const event of runAudit(request)) {
      session.events.push(event)
      if (event.type === "error") session.error = event.message
      for (const listener of session.listeners) listener()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The run stopped."
    session.error = message
    session.events.push({ type: "error", message })
    for (const listener of session.listeners) listener()
  } finally {
    session.done = true
    for (const listener of session.listeners) listener()
  }
}

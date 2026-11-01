import { getSession } from "@/lib/sessions"

export const dynamic = "force-dynamic"

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let closed = false
  let detach = () => {}
  const stream = new ReadableStream({
    async start(controller) {
      const { id } = await context.params
      const session = getSession(id)
      const encoder = new TextEncoder()
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
          detach()
        }
      }
      if (!session) {
        send({ type: "error", message: "That run does not exist." })
        closed = true
        controller.close()
        return
      }
      let cursor = 0
      const flush = () => {
        while (cursor < session.events.length) {
          send(session.events[cursor])
          cursor += 1
        }
      }
      flush()
      if (session.done) {
        send({ type: "end" })
        closed = true
        controller.close()
        return
      }
      await new Promise<void>((resolve) => {
        const listener = () => {
          flush()
          if (session.done) {
            session.listeners.delete(listener)
            send({ type: "end" })
            resolve()
          }
        }
        detach = () => {
          session.listeners.delete(listener)
          resolve()
        }
        session.listeners.add(listener)
      })
      if (!closed) {
        closed = true
        try { controller.close() } catch {}
      }
    },
    cancel() {
      closed = true
      detach()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}

import { getSession } from "@/lib/sessions"

export const dynamic = "force-dynamic"

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const stream = new ReadableStream({
    async start(controller) {
      const { id } = await context.params
      const session = getSession(id)
      const encoder = new TextEncoder()
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      if (!session) {
        send({ type: "error", message: "That run does not exist." })
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
        session.listeners.add(listener)
      })
      controller.close()
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

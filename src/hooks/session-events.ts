import type { Context } from "../plugin-types"
import type { SessionManager } from "../session/manager"

/**
 * Subscribe to the server event stream and close the SSH connection of a session
 * that no longer exists. Everything else is handled by the cleanup function that
 * `setup` returns, so a single failed tool call no longer drops the connection.
 *
 * Returns a function that stops the subscription.
 */
export function createSessionEvents(ctx: Context, sessions: SessionManager): () => void {
  const controller = new AbortController()

  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "session.deleted") {
          sessions.remove(event.data.sessionID)
        }
      }
    } catch {
      // The subscription is aborted on plugin unload; nothing left to clean up here.
    }
  })()

  return () => controller.abort()
}

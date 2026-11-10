import type { SessionManager } from "../session/manager"
import { withMutex } from "../session/mutex"
import type { SessionState } from "../session/state"
import { setConnected } from "../shared"

/**
 * Run a body against a session and make sure a failure never leaves a half used
 * session behind.
 *
 * When a command times out the stream is desynced: the remote command may still be
 * writing, so the next frame would be attributed to it. Dropping the session here is
 * what keeps a failed transfer or a timed out command from corrupting later output.
 */
export async function runInSession<T>(
  sessions: SessionManager,
  sessionID: string,
  state: SessionState,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await withMutex(state, body)
  } catch (error) {
    sessions.remove(sessionID)
    setConnected(null)
    throw error
  }
}

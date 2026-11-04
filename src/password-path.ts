import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Where the TUI part leaves the password for the server part.
 *
 * The two run in different processes and the RPC method path rejects the reply, so
 * the answer travels through a short-lived file instead: created by the TUI, read and
 * deleted by the server. It never lives longer than one connect attempt.
 */
export function passwordPath(requestID: string): string {
  return join(tmpdir(), "opencode-ssh-session", `pw-${requestID}`)
}

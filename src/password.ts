import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { note } from "./diag"
import { passwordPath } from "./password-path"
import { shared } from "./shared"

export type PasswordPromptResult =
  /** The user answered. */
  | string
  /** The dialog is not available (no UI part, or the event could not be sent). */
  | undefined
  /** Nothing arrived before the deadline. */
  | null

/**
 * Ask the UI for a password.
 *
 * The request travels over RPC: the TUI part and the GUI part both subscribe to
 * `requestPassword`. The answer arrives through whichever channel the client can use —
 * an RPC method call (web, desktop) or the short-lived hand-off file (TUI), so both are
 * watched here.
 */
export async function requestPassword(
  host: string,
  timeoutMs = 25_000,
): Promise<PasswordPromptResult> {
  const emit = shared.emitPasswordRequest
  if (!emit) return undefined

  const requestID = randomUUID()
  const file = passwordPath(requestID)

  await mkdir(dirname(file), { recursive: true })
  await rm(file, { force: true }).catch(() => {})

  return await new Promise<PasswordPromptResult>((resolve) => {
    let settled = false
    let poll: ReturnType<typeof setInterval> | undefined

    const finish = (value: PasswordPromptResult) => {
      if (settled) return
      settled = true
      if (poll) clearInterval(poll)
      clearTimeout(timer)
      shared.passwordRequests.delete(requestID)
      resolve(value)
    }

    const timer = setTimeout(() => {
      note("prompt: timed out waiting for an answer")
      finish(undefined)
    }, timeoutMs)

    // Channel 1: RPC method call from the GUI or TUI part.
    shared.passwordRequests.set(requestID, (password) => {
      if (password && password.length > 0) finish(password)
    })

    // Channel 2: the TUI writes the answer to a short-lived file.
    poll = setInterval(() => {
      void readFile(file, "utf8")
        .then(async (value) => {
          await rm(file, { force: true }).catch(() => {})
          if (value.length > 0) finish(value)
        })
        .catch(() => {})
    }, 150)

    void emit({ requestID, host }).catch(() => finish(undefined))
  })
}

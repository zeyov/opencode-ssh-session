import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { note } from "./diag"
import { passwordPath } from "./password-path"
import { shared } from "./shared"

export type PasswordPromptResult =
  /** The user answered. */
  | string
  /** The dialog is not available (no TUI part, or the event could not be sent). */
  | undefined
  /** The user cancelled, or nothing arrived before the deadline. */
  | null

/**
 * Ask the TUI for a password.
 *
 * The request travels over RPC (the TUI shows OpenCode's prompt), the answer comes
 * back through a short-lived file. `undefined` means the dialog is unavailable and the
 * caller should fall back to the askpass program; `null` means it was cancelled.
 */
export async function requestPassword(
  host: string,
  timeoutMs = 10_000,
): Promise<PasswordPromptResult> {
  const emit = shared.emitPasswordRequest
  if (!emit) {
    note("prompt: no bridge, handing over to askpass")
    return undefined
  }

  const requestID = randomUUID()
  const file = passwordPath(requestID)

  await mkdir(dirname(file), { recursive: true })
  await rm(file, { force: true }).catch(() => {})

  try {
    await emit({ requestID, host })
    note(`prompt: emitted ${requestID} for ${host}`)
  } catch (error) {
    note(`prompt: emit failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await readFile(file, "utf8")
      await rm(file, { force: true }).catch(() => {})
      if (value.length === 0) {
        // A stale or broken TUI instance wrote an empty answer. Ignore it and keep
        // waiting for a real one instead of failing the prompt.
        note("prompt: empty answer ignored")
      } else {
        note(`prompt: answer received (${value.length} bytes)`)
        return value
      }
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  note("prompt: timed out waiting for the dialog")
  // No dialog answered: the caller falls back to the askpass program.
  return undefined
}

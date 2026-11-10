import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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

const PASSWORD_DIR = join(tmpdir(), "opencode-ssh-session")
/** Answers older than this are leftovers from a dialog nobody answered. */
const STALE_ANSWER_MS = 10 * 60_000

let sweepStarted = false

/**
 * Delete password hand-off files that were never picked up.
 *
 * The server removes an answer as soon as it reads it, but when the dialog times
 * out (or the TUI writes after the deadline) the plaintext password used to stay
 * in the temp directory forever.
 */
function sweepStaleAnswers(): void {
  if (sweepStarted) return
  sweepStarted = true

  void (async () => {
    try {
      const entries = await readdir(PASSWORD_DIR)
      const now = Date.now()
      await Promise.all(
        entries.map(async (name) => {
          if (!name.startsWith("pw-")) return
          const file = join(PASSWORD_DIR, name)
          const info = await stat(file).catch(() => null)
          if (info && now - info.mtimeMs > STALE_ANSWER_MS) {
            await rm(file, { force: true }).catch(() => {})
          }
        }),
      )
    } catch {
      // No directory yet; nothing to sweep.
    }
  })()
}

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

  sweepStaleAnswers()

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
  // Do not leave the answer (or a late writer's file) behind.
  await rm(file, { force: true }).catch(() => {})
  // No dialog answered: the caller falls back to the askpass program.
  return undefined
}

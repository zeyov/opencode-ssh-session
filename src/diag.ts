import { appendFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const FILE = join(tmpdir(), "opencode-ssh-session", "diag.log")
const ENABLED = Boolean(process.env.OC_SSH_DIAG)

/**
 * Diagnostic trail for the password hand-off and the status bar, which span two
 * processes and are invisible from the transcript. Off unless `OC_SSH_DIAG=1`.
 */
export function note(message: string): void {
  if (!ENABLED) return

  const line = `${new Date().toISOString()} ${message}\n`
  void mkdir(dirname(FILE), { recursive: true })
    .then(() => appendFile(FILE, line))
    .catch(() => {})
}

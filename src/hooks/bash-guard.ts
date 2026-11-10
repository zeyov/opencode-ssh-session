import { isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"
import { shellQuote } from "../session/shell"

/**
 * Patterns that suggest the user/AI is trying to run SSH-related operations
 * through the built-in shell tool instead of the plugin's SSH tools.
 *
 * The pattern matches the command position as well as common prefixes such as
 * `sudo`, so `sudo ssh ...` and `FOO=1 ssh ...` are recognised too.
 */
const SSH_PATTERNS = [
  /(^|[;&|]\s*|\bthen\s+|\bdo\s+|\belse\s+)(sudo\s+)?(ssh|scp|sftp)(\.exe)?\s/,
  /(^|[;&|]\s*)(sudo\s+)?rsync\s+[^\n]*:/,
]

/** Tool ids that run a local shell command; the hook is skipped for everything else. */
const SHELL_TOOLS = new Set(["bash", "shell"])

interface ExecuteBeforeEvent {
  readonly tool: string
  readonly sessionID: string
  input: unknown
}

/**
 * Create a `tool.execute.before` hook that detects when the AI uses the local shell
 * for SSH-like operations and prepends a reminder to use the SSH tools.
 */
export function createBashGuard(sessions: SessionManager) {
  return (event: ExecuteBeforeEvent) => {
    if (!SHELL_TOOLS.has(event.tool)) return

    const input = event.input as { command?: unknown }
    if (!input || typeof input !== "object") return
    const command = typeof input.command === "string" ? input.command : ""
    if (!command) return

    const isSSHCommand = SSH_PATTERNS.some((pattern) => pattern.test(command))
    if (!isSSHCommand) return

    const connected = isAlive(sessions.peek(event.sessionID))
    const hint = connected
      ? "NOTE: You have an active SSH session. Use the `ssh` tool to run commands on the remote host instead of spawning a new ssh process via bash."
      : "NOTE: Use `ssh_connect` to establish a persistent SSH session, then `ssh` to run commands. This preserves shell state between calls and avoids reconnection overhead."

    // Prepend the hint as a comment so it shows up in tool output. Written with
    // printf so a command containing quotes or `echo` flags cannot break it.
    const rewrite = `printf '%s\\n' ${shellQuote(hint)} >&2; ${command}`

    try {
      input.command = rewrite
    } catch {
      // Some runtimes hand out a frozen input object; skipping the hint is fine.
    }
  }
}

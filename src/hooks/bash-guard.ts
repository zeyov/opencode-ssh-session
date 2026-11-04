import { isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"

/**
 * Patterns that suggest the user/AI is trying to run SSH-related operations
 * through the built-in bash tool instead of the plugin's SSH tools.
 */
const SSH_PATTERNS = [/^\s*ssh\s+/, /^\s*scp\s+/, /^\s*sftp\s+/, /^\s*rsync\s+.*:/]

interface ExecuteBeforeEvent {
  readonly tool: string
  readonly sessionID: string
  input: unknown
}

/**
 * Create a `tool.execute.before` hook that detects when the AI uses bash
 * for SSH-like operations and prepends a reminder to use the SSH tools.
 */
export function createBashGuard(sessions: SessionManager) {
  return (event: ExecuteBeforeEvent) => {
    if (event.tool !== "bash") return

    const input = event.input as { command?: unknown }
    const command = typeof input.command === "string" ? input.command : ""
    if (!command) return

    const isSSHCommand = SSH_PATTERNS.some((pattern) => pattern.test(command))
    if (!isSSHCommand) return

    const connected = isAlive(sessions.peek(event.sessionID))
    const hint = connected
      ? "NOTE: You have an active SSH session. Use the `ssh` tool to run commands on the remote host instead of spawning a new ssh process via bash."
      : "NOTE: Use `ssh_connect` to establish a persistent SSH session, then `ssh` to run commands. This preserves shell state between calls and avoids reconnection overhead."

    // Prepend the hint as a comment so it shows up in tool output
    input.command = `echo '${hint}' >&2; ${command}`
  }
}

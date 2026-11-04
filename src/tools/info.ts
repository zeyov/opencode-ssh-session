import type { ToolDefinition } from "../plugin-types"
import { isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function createInfoTool(sessions: SessionManager): ToolDefinition {
  return {
    name: "ssh_info",
    description:
      "Get information about the current SSH session. " +
      "Returns the connected host, session duration, and whether the session is alive. " +
      "Use this to check connection status before running commands.",
    input: { type: "object", properties: {}, additionalProperties: false },
    async execute(_input, context) {
      const state = sessions.peek(context.sessionID)
      if (!state || !isAlive(state) || !state.host) {
        return { content: "No active SSH session." }
      }

      const duration = state.connectedAt
        ? formatDuration(Date.now() - state.connectedAt)
        : "unknown"
      const queueLength = state.commandQueue.length
      const busy = state.running ? "yes" : "no"

      const content = [
        `Host: ${state.host}`,
        `Connected: ${duration}`,
        `Busy: ${busy}`,
        queueLength > 0 ? `Queued commands: ${queueLength}` : null,
      ]
        .filter(Boolean)
        .join("\n")

      return { content }
    },
  }
}

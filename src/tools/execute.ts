import type { Context, ToolDefinition } from "../plugin-types"
import { executeCommand, isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"
import { runInSession } from "./guard"
import { authorize } from "./permissions"

const DEFAULT_TIMEOUT = 120_000

export function createExecuteTool(sessions: SessionManager, plugin: Context): ToolDefinition {
  return {
    name: "ssh",
    description:
      "Execute a command on the active persistent SSH session. " +
      "Shell state (cd, exported variables, etc.) persists across calls. " +
      "Requires ssh_connect to have been called first. " +
      "Does NOT support interactive/TUI commands (vim, top, etc.).",
    input: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute on the remote host" },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000 = 2 minutes)",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const args = input as { command: string; timeout?: number }
      const state = sessions.peek(context.sessionID)
      if (!state || !isAlive(state)) {
        return {
          content: "No active SSH session. Use ssh_connect to establish a connection first.",
        }
      }

      await authorize(plugin, context, "bash", [args.command], { host: state.host })

      const content = await runInSession(sessions, context.sessionID, state, () =>
        executeCommand(state, args.command, args.timeout ?? DEFAULT_TIMEOUT, context.signal),
      )

      return { content }
    },
  }
}

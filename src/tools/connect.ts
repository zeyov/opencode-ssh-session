import { askpassOf } from "../options"
import { requestPassword } from "../password"
import type { Context, ToolDefinition } from "../plugin-types"
import { spawnWithPasswordFallback } from "../session/auth"
import { isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"
import { withMutex } from "../session/mutex"
import { setConnected } from "../shared"
import { authorize } from "./permissions"

export function createConnectTool(sessions: SessionManager, plugin: Context): ToolDefinition {
  return {
    name: "ssh_connect",
    description:
      "Open a persistent SSH session to a remote host. " +
      "Once connected, use the `ssh` tool to run commands — " +
      "shell state (cd, env vars, etc.) persists between calls. " +
      "Use `ssh_disconnect` to close the session when done.",
    input: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description:
            "SSH host to connect to (e.g. 'user@server', 'myalias', 'user@192.168.1.10')",
        },
        options: {
          type: "string",
          description: "Extra SSH flags: -p, -l, -i, -J only (e.g. '-p 2222', '-i ~/.ssh/mykey')",
        },
      },
      required: ["host"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const args = input as { host: string; options?: string }
      let state = sessions.get(context.sessionID)
      if (isAlive(state) && state.host === args.host) {
        return { content: `Already connected to ${args.host}.` }
      }

      await authorize(plugin, context, "ssh_connect", [args.host], { host: args.host })

      if (isAlive(state)) {
        state = sessions.replace(context.sessionID)
      }

      try {
        const content = await withMutex(state, () =>
          spawnWithPasswordFallback(
            state,
            args.host,
            args.options,
            context.signal,
            { askpass: askpassOf(plugin) },
            requestPassword,
          ),
        )
        setConnected(args.host)
        return { content }
      } catch (error) {
        sessions.remove(context.sessionID)
        setConnected(null)
        throw error
      }
    },
  }
}

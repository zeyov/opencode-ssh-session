import { askpassOf } from "../options"
import { requestPassword } from "../password"
import type { Context, ToolDefinition } from "../plugin-types"
import { spawnWithPasswordFallback } from "../session/auth"
import { isAlive } from "../session/commands"
import { validateHost } from "../session/connection"
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
      // Validate before asking for permission, so a value such as
      // `-oProxyCommand=...` is never approved and never reaches argv.
      const host = validateHost(args.host)
      const options = args.options ?? ""

      let state = sessions.get(context.sessionID)
      if (isAlive(state) && state.host === host && state.options === options) {
        return { content: `Already connected to ${host}.` }
      }

      await authorize(plugin, context, "ssh_connect", [host], { host })

      // Different host, or the same host with different flags (port, key, jump
      // host): the old session cannot serve the new request, so replace it.
      if (isAlive(state)) {
        state = sessions.replace(context.sessionID)
      }

      try {
        const content = await withMutex(state, () =>
          spawnWithPasswordFallback(
            state,
            host,
            options || undefined,
            context.signal,
            { askpass: askpassOf(plugin) },
            requestPassword,
          ),
        )
        setConnected(host)
        return { content }
      } catch (error) {
        sessions.remove(context.sessionID)
        setConnected(null)
        throw error
      }
    },
  }
}

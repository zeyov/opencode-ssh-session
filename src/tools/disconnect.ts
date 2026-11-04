import type { ToolDefinition } from "../plugin-types"
import type { SessionManager } from "../session/manager"
import { setConnected } from "../shared"

export function createDisconnectTool(sessions: SessionManager): ToolDefinition {
  return {
    name: "ssh_disconnect",
    description:
      "Close the active persistent SSH session. " +
      "Shell state is lost. You can reconnect later with ssh_connect.",
    input: { type: "object", properties: {}, additionalProperties: false },
    async execute(_input, context) {
      const content = sessions.remove(context.sessionID)
      setConnected(null)
      return { content }
    },
  }
}

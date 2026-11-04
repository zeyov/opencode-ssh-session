import { Plugin } from "@opencode/plugin"
import { note } from "./diag"
import { createBashGuard } from "./hooks/bash-guard"
import { registerCommands } from "./hooks/commands"
import { createSessionEvents } from "./hooks/session-events"
import { SSHPasswordRpc } from "./rpc"
import { shared } from "./shared"
import { createConnectTool } from "./tools/connect"
import { createDisconnectTool } from "./tools/disconnect"
import { createDownloadTool } from "./tools/download"
import { createExecuteTool } from "./tools/execute"
import { createInfoTool } from "./tools/info"
import { createUploadTool } from "./tools/upload"

/**
 * The runtime may create more than one plugin instance for the same location, so the
 * session manager lives in a process-wide singleton: every instance must see the same
 * SSH processes, otherwise a command and a tool can end up talking to different sessions.
 */
const sessions = shared.sessions

export const SSHSession = Plugin.define({
  id: "opencode-ssh-session",
  async setup(ctx) {
    shared.instances++

    await ctx.tool.transform((editor) => {
      editor.add(createConnectTool(sessions, ctx))
      editor.add(createExecuteTool(sessions, ctx))
      editor.add(createDisconnectTool(sessions))
      editor.add(createInfoTool(sessions))
      editor.add(createUploadTool(sessions, ctx))
      editor.add(createDownloadTool(sessions, ctx))
    })

    await ctx.tool.hook("execute.before", createBashGuard(sessions))

    await registerCommands(ctx, sessions)

    try {
      const registration = await ctx.rpc.register(SSHPasswordRpc, {})
      shared.emitPasswordRequest = (payload) => registration.events.emit("requestPassword", payload)
      shared.publishConnection = (host) =>
        registration.events.emit("connection", { host: host ?? "" })
      note("rpc: registered requestPassword + connection")
    } catch (error) {
      // Without RPC the askpass program still prompts on its own.
      shared.emitPasswordRequest = undefined
      shared.publishConnection = undefined
      note(`rpc: register failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Push the current state so a reloaded TUI part learns about an existing session.
    void shared.publishConnection?.(shared.connectedHost).catch(() => {})

    const stopEvents = createSessionEvents(ctx, sessions)

    return () => {
      stopEvents()
      shared.instances--
      if (shared.instances <= 0) sessions.dispose()
    }
  },
})

export default SSHSession

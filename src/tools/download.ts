import type { Context, ToolDefinition } from "../plugin-types"
import { executeCommand, isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"
import { withMutex } from "../session/mutex"
import { shellQuote } from "../session/shell"
import { authorizeTransfer } from "./permissions"

const DOWNLOAD_TIMEOUT = 120_000

export function createDownloadTool(sessions: SessionManager, plugin: Context): ToolDefinition {
  return {
    name: "ssh_download",
    description:
      "Download a file from the remote host to the local machine through the active SSH session. " +
      "Uses base64 encoding to transfer the file content over the existing connection. " +
      "Requires ssh_connect to have been called first.",
    input: {
      type: "object",
      properties: {
        remotePath: { type: "string", description: "Path to the file on the remote host" },
        localPath: { type: "string", description: "Destination path on the local machine" },
      },
      required: ["remotePath", "localPath"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const args = input as { remotePath: string; localPath: string }
      const state = sessions.peek(context.sessionID)
      if (!state || !isAlive(state) || !state.host) {
        return {
          content: "No active SSH session. Use ssh_connect to establish a connection first.",
        }
      }

      const localPath = await authorizeTransfer(plugin, context, {
        host: state.host,
        localPath: args.localPath,
        localPermission: "edit",
        remotePath: args.remotePath,
        remotePermission: "read",
      })

      const content = await withMutex(state, async () => {
        // Check remote file exists
        const remotePath = shellQuote(args.remotePath)
        const checkResult = await executeCommand(
          state,
          `test -f ${remotePath} && echo "EXISTS" || echo "NOT_FOUND"`,
          DOWNLOAD_TIMEOUT,
        )
        if (checkResult.trim() === "NOT_FOUND") {
          return `Remote file not found: ${args.remotePath}`
        }

        // Base64-encode on remote and capture output
        const b64Result = await executeCommand(state, `base64 < ${remotePath}`, DOWNLOAD_TIMEOUT)
        if (b64Result.includes("[exit code:")) {
          return `Failed to read remote file: ${b64Result}`
        }

        // Decode and write locally
        const cleaned = b64Result.replace(/\s/g, "")
        const bytes = Buffer.from(cleaned, "base64")

        await Bun.write(localPath, bytes)

        return `Downloaded ${state.host}:${args.remotePath} to ${args.localPath} (${bytes.byteLength} bytes)`
      })

      return { content }
    },
  }
}

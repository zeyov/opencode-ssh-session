import { randomBytes } from "node:crypto"
import { rename, stat, unlink } from "node:fs/promises"
import type { Context, ToolDefinition } from "../plugin-types"
import { executeCommandResult, isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"
import { remotePathExpr } from "../session/remote-path"
import { runInSession } from "./guard"
import { authorizeTransfer } from "./permissions"

const DOWNLOAD_TIMEOUT = 120_000
const PROBE_TIMEOUT = 30_000

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

      const downloaded = await runInSession(
        sessions,
        context.sessionID,
        state,
        async (): Promise<{ bytes: Uint8Array; remoteSize: number } | string> => {
          const source = remotePathExpr(args.remotePath)

          const probe = await executeCommandResult(
            state,
            `if [ -f ${source} ]; then wc -c < ${source}; ` +
              `elif [ -d ${source} ]; then echo __OC_IS_DIR__; ` +
              `else echo __OC_NO_FILE__; fi`,
            PROBE_TIMEOUT,
          )
          if (probe.output.includes("__OC_NO_FILE__")) {
            return `Remote file not found: ${args.remotePath}`
          }
          if (probe.output.includes("__OC_IS_DIR__")) {
            return `Remote path is a directory, not a file: ${args.remotePath}`
          }

          const reported = Number(probe.output.trim())
          const remoteSize = Number.isFinite(reported) ? reported : Number.NaN

          const encoded = await executeCommandResult(state, `base64 < ${source}`, DOWNLOAD_TIMEOUT)
          if (encoded.exitCode !== 0) {
            return `Failed to read remote file: ${encoded.output}`
          }

          const cleaned = encoded.output.replace(/\s/g, "")
          // A truncated or interleaved frame would still decode "successfully" with
          // Buffer.from, so reject anything that is not plain base64 first.
          if (cleaned.length > 0 && !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
            return "Failed to decode remote file: the transfer contained non-base64 data."
          }

          const bytes = new Uint8Array(Buffer.from(cleaned, "base64"))
          if (Number.isFinite(remoteSize) && remoteSize !== bytes.byteLength) {
            return (
              `Transfer is incomplete: expected ${remoteSize} bytes, decoded ${bytes.byteLength}. ` +
              "The session was left untouched; try again."
            )
          }

          return { bytes, remoteSize: bytes.byteLength }
        },
      )

      if (typeof downloaded === "string") return { content: downloaded }

      const destinationIsDirectory = await stat(localPath)
        .then((info) => info.isDirectory())
        .catch(() => false)
      if (destinationIsDirectory) {
        return { content: `Local path is a directory, not a file: ${args.localPath}` }
      }

      // Write next to the destination and rename, so a failed transfer never leaves
      // a half written file in place of an existing one.
      const part = `${localPath}.oc-part-${randomBytes(4).toString("hex")}`
      try {
        await Bun.write(part, downloaded.bytes)
        await rename(part, localPath)
      } catch (error) {
        await unlink(part).catch(() => {})
        return {
          content: `Failed to write the downloaded file to ${args.localPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      }

      return {
        content: `Downloaded ${state.host}:${args.remotePath} to ${args.localPath} (${downloaded.remoteSize} bytes)`,
      }
    },
  }
}

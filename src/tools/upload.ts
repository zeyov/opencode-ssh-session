import { randomBytes } from "node:crypto"
import type { Context, ToolDefinition } from "../plugin-types"
import { executeCommandResult, isAlive } from "../session/commands"
import type { SessionManager } from "../session/manager"
import { remotePathExpr } from "../session/remote-path"
import { runInSession } from "./guard"
import { authorizeTransfer } from "./permissions"

const UPLOAD_TIMEOUT = 120_000
const PROBE_TIMEOUT = 30_000
/** 32 KiB of base64 per round trip keeps a 1 MB file at ~40 commands instead of ~340. */
const CHUNK_SIZE = 32 * 1024

export function createUploadTool(sessions: SessionManager, plugin: Context): ToolDefinition {
  return {
    name: "ssh_upload",
    description:
      "Upload a local file to the remote host through the active SSH session. " +
      "Uses base64 encoding to transfer the file content over the existing connection. " +
      "Requires ssh_connect to have been called first.",
    input: {
      type: "object",
      properties: {
        localPath: { type: "string", description: "Absolute path to the local file to upload" },
        remotePath: { type: "string", description: "Destination path on the remote host" },
      },
      required: ["localPath", "remotePath"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const args = input as { localPath: string; remotePath: string }
      const state = sessions.peek(context.sessionID)
      if (!state || !isAlive(state) || !state.host) {
        return {
          content: "No active SSH session. Use ssh_connect to establish a connection first.",
        }
      }

      const localPath = await authorizeTransfer(plugin, context, {
        host: state.host,
        localPath: args.localPath,
        localPermission: "read",
        remotePath: args.remotePath,
        remotePermission: "edit",
      })
      const file = Bun.file(localPath)
      const exists = await file.exists()
      if (!exists) {
        return { content: `Local file not found: ${args.localPath}` }
      }

      const bytes = new Uint8Array(await file.arrayBuffer())
      const base64 = Buffer.from(bytes).toString("base64")

      const content = await runInSession(sessions, context.sessionID, state, async () => {
        const destination = remotePathExpr(args.remotePath)
        const suffix = randomBytes(16).toString("hex")
        // A random name in the remote temp directory: the old predictable
        // `/tmp/.oc_upload_<timestamp>` could be pre-created as a symlink.
        const staging = `"\${TMPDIR:-/tmp}/.oc_upload_${suffix}"`
        const decoded = `"\${TMPDIR:-/tmp}/.oc_upload_${suffix}.part"`

        const removeStaging = async () => {
          await executeCommandResult(state, `rm -f ${staging} ${decoded}`, PROBE_TIMEOUT).catch(
            () => {},
          )
        }

        // Fail before transferring gigabytes into a directory that does not exist.
        const parent = await executeCommandResult(
          state,
          `if [ -d ${destination} ]; then echo __OC_IS_DIR__; ` +
            `elif [ ! -d "$(dirname ${destination})" ]; then echo __OC_NO_PARENT__; fi`,
          PROBE_TIMEOUT,
        )
        if (parent.output.includes("__OC_IS_DIR__")) {
          return `Remote path is a directory, not a file: ${args.remotePath}`
        }
        if (parent.output.includes("__OC_NO_PARENT__")) {
          return `Remote directory does not exist: ${args.remotePath}`
        }

        const init = await executeCommandResult(
          state,
          `( umask 077; : > ${staging} )`,
          UPLOAD_TIMEOUT,
        )
        if (init.exitCode !== 0) {
          return `Failed to create temp file on remote: ${init.output}`
        }

        for (let offset = 0; offset < base64.length; offset += CHUNK_SIZE) {
          const chunk = base64.slice(offset, offset + CHUNK_SIZE)
          const result = await executeCommandResult(
            state,
            `printf '%s' '${chunk}' >> ${staging}`,
            UPLOAD_TIMEOUT,
          )
          if (result.exitCode !== 0) {
            await removeStaging()
            return `Failed to write chunk to remote: ${result.output}`
          }
        }

        // `base64 -d` is GNU, `base64 --decode` is the portable spelling and
        // `openssl` is the fallback for systems without either. Never `exit` in
        // generated shell code: that would take the session shell down with it.
        const decode = await executeCommandResult(
          state,
          `{ base64 -d < ${staging} > ${decoded} ; } 2>/dev/null || ` +
            `{ base64 --decode < ${staging} > ${decoded} ; } 2>/dev/null || ` +
            `{ openssl base64 -d -A < ${staging} > ${decoded} ; } 2>/dev/null || ` +
            `echo __OC_DECODE_FAILED__; ` +
            `echo __OC_SIZE__$(wc -c < ${decoded} 2>/dev/null || echo 0)`,
          UPLOAD_TIMEOUT,
        )
        if (decode.output.includes("__OC_DECODE_FAILED__")) {
          await removeStaging()
          return `Failed to decode file on remote: ${decode.output}`
        }

        const sizeMatch = decode.output.match(/__OC_SIZE__(\d+)/)
        const written = sizeMatch ? Number(sizeMatch[1]) : Number.NaN
        if (Number.isFinite(written) && written !== bytes.byteLength) {
          await removeStaging()
          return `Upload verification failed: remote file is ${written} bytes, expected ${bytes.byteLength}.`
        }

        const move = await executeCommandResult(
          state,
          `mv -f ${decoded} ${destination}; rm -f ${staging}`,
          UPLOAD_TIMEOUT,
        )
        if (move.exitCode !== 0) {
          await removeStaging()
          return `Failed to move the uploaded file into place: ${move.output}`
        }

        return `Uploaded ${args.localPath} to ${state.host}:${args.remotePath} (${bytes.byteLength} bytes)`
      })

      return { content }
    },
  }
}

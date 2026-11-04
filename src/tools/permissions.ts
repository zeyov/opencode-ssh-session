import { isAbsolute, relative, resolve, sep } from "node:path"
import type { Context, ToolExecuteContext } from "../plugin-types"

type Permission = "read" | "edit"

/**
 * Ask the runtime for permission through the same rule engine the built-in tools use.
 * A deny rule or a rejection rejects with a `Tool.Error`, which the caller must rethrow.
 */
export async function authorize(
  plugin: Context,
  context: ToolExecuteContext,
  action: string,
  resources: string[],
  metadata?: Record<string, unknown>,
): Promise<void> {
  await plugin.permission.assert({
    sessionID: context.sessionID,
    agent: context.agent,
    source: { type: "tool", messageID: context.messageID, id: context.id },
    action,
    resources,
    save: resources,
    metadata,
  })
}

interface TransferPermissions {
  host: string
  localPath: string
  localPermission: Permission
  remotePath: string
  remotePermission: Permission
}

export async function authorizeTransfer(
  plugin: Context,
  context: ToolExecuteContext,
  input: TransferPermissions,
): Promise<string> {
  const base = plugin.location.directory
  const worktree = plugin.location.project.directory
  const localPath = resolve(base, input.localPath)
  const worktreeRelativePath = relative(worktree, localPath)
  const outsideWorktree =
    worktreeRelativePath === ".." ||
    worktreeRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(worktreeRelativePath)

  const askLocal = async () => {
    if (outsideWorktree) {
      await authorize(plugin, context, "external_directory", [localPath], { path: localPath })
    }

    await authorize(plugin, context, input.localPermission, [localPath], { path: localPath })
  }

  const remoteResource = `${input.host}:${input.remotePath}`
  const askRemote = () =>
    authorize(plugin, context, input.remotePermission, [remoteResource], {
      host: input.host,
      path: input.remotePath,
    })

  if (input.localPermission === "read") {
    await askLocal()
    await askRemote()
  } else {
    await askRemote()
    await askLocal()
  }

  return localPath
}

import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Context, ToolExecuteContext } from "../plugin-types"

type Permission = "read" | "edit"

/**
 * Expand a leading `~` before the path is resolved.
 *
 * Without this, `~/notes.txt` was resolved against the project directory and the
 * permission prompt, the error message and the file access all pointed at a path
 * that does not exist (`<project>/~/notes.txt`).
 */
export function expandHome(value: string): string {
  const trimmed = value.trim()
  if (trimmed === "~") return homedir()
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2))
  }
  return trimmed
}

/**
 * Resolve a path, following symlinks in the part of it that exists.
 *
 * The permission check has to see the real target: a symlink inside the project
 * that points at `~/.ssh` used to pass the textual "inside the worktree" test and
 * skipped the `external_directory` prompt entirely.
 */
export async function realpathSafe(target: string, depth = 0): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    // Missing leaf: resolve the nearest existing ancestor instead.
  }
  const parent = dirname(target)
  if (parent === target || depth > 64) return target
  return join(await realpathSafe(parent, depth + 1), basename(target))
}

function isOutside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

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
  const localPath = resolve(base, expandHome(input.localPath))
  const realLocalPath = await realpathSafe(localPath)
  const outsideWorktree = isOutside(worktree, localPath) || isOutside(worktree, realLocalPath)

  const askLocal = async () => {
    if (outsideWorktree) {
      // Ask with the real target so the prompt cannot be satisfied by a symlink
      // that only looks like it lives inside the project.
      await authorize(plugin, context, "external_directory", [realLocalPath], {
        path: realLocalPath,
      })
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

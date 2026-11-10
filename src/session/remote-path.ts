import { shellQuote } from "./shell"

/**
 * Turn a user supplied remote path into shell code.
 *
 * A leading `~` has to stay outside the quotes, otherwise the remote shell treats
 * it as a literal directory named `~` and every `~/file` transfer failed with
 * "No such file or directory". Everything else stays quoted, also `$HOME`.
 */
export function remotePathExpr(value: string): string {
  const trimmed = value.trim()
  if (trimmed === "~") return '"$HOME"'
  if (trimmed.startsWith("~/")) return `"$HOME"/${shellQuote(trimmed.slice(2))}`
  return shellQuote(trimmed)
}

/** Human readable form, used in messages and permission resources (unchanged). */
export function remotePathLabel(value: string): string {
  return value.trim()
}

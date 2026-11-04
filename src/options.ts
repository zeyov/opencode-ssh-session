import { isAbsolute, resolve } from "node:path"
import type { Context } from "./plugin-types"

/**
 * Resolve the `askpass` plugin option. A relative value is resolved against the
 * project directory, so the project config can point at a script inside the repo.
 */
export function askpassOf(ctx: Context): string | undefined {
  const raw = (ctx.options as Record<string, unknown> | undefined)?.askpass
  if (typeof raw !== "string" || raw.length === 0) return undefined
  return isAbsolute(raw) ? raw : resolve(ctx.location.directory, raw)
}

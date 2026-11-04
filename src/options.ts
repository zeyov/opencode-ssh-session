import { existsSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "./plugin-types"

/** The Windows helper that ships with this plugin, next to `src/`. */
const BUNDLED_ASKPASS = fileURLToPath(new URL("../scripts/askpass.exe", import.meta.url))

/**
 * Resolve the askpass helper.
 *
 * 1. The `askpass` plugin option wins. A relative value resolves against the project
 *    directory.
 * 2. Otherwise use the helper that ships with the plugin, so a plain clone (for
 *    example under `~/.config/opencode/plugins/`) needs no configuration at all.
 */
export function askpassOf(ctx: Context): string | undefined {
  const configured = (ctx.options as Record<string, unknown> | undefined)?.askpass

  if (typeof configured === "string" && configured.length > 0) {
    return isAbsolute(configured) ? configured : resolve(ctx.location.directory, configured)
  }

  return existsSync(BUNDLED_ASKPASS) ? BUNDLED_ASKPASS : undefined
}

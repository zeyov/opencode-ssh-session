import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * The helper that hands the password to OpenSSH.
 *
 * It ships with the plugin and only echoes `OC_SSH_PASSWORD`, so users never see a
 * prompt from it and never configure anything.
 */
const BUNDLED_ASKPASS = fileURLToPath(new URL("../scripts/askpass.exe", import.meta.url))

export function bundledAskpass(): string | undefined {
  return existsSync(BUNDLED_ASKPASS) ? BUNDLED_ASKPASS : undefined
}

import type { PasswordPromptResult } from "../password"
import { type SpawnOptions, spawnSSH } from "./connection"
import type { SessionState } from "./state"

/**
 * Connect, and if OpenSSH reports that no key was accepted, ask for a password once
 * and retry. The retry reuses the same session state, so callers do not need to care
 * which authentication path won.
 *
 * The first attempt is always non-interactive, so key and agent users are never
 * prompted. The retry prefers the OpenCode dialog and falls back to the askpass
 * program when that dialog is unavailable.
 */
export async function spawnWithPasswordFallback(
  state: SessionState,
  host: string,
  options: string | undefined,
  signal: AbortSignal | undefined,
  spawnOptions: SpawnOptions,
  askPassword: ((host: string) => Promise<PasswordPromptResult>) | undefined,
): Promise<string> {
  try {
    return await spawnSSH(state, host, options, signal, { askpass: spawnOptions.askpass })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!/Permission denied \(publickey/i.test(message)) throw error

    if (!spawnOptions.askpass) {
      throw new Error(
        `${message}\nNo askpass program is configured, so a password cannot be handed to ssh. ` +
          "Set the plugin `askpass` option, or install a key.",
      )
    }

    const password = askPassword ? await askPassword(host) : undefined

    if (typeof password === "string" && password.length > 0) {
      return await spawnSSH(state, host, options, signal, {
        askpass: spawnOptions.askpass,
        password,
      })
    }

    if (password === null) {
      throw new Error(`${message}\nPassword entry was cancelled.`)
    }

    // No dialog available: let the askpass program prompt by itself.
    return await spawnSSH(state, host, options, signal, {
      askpass: spawnOptions.askpass,
      allowAskpass: true,
    })
  }
}

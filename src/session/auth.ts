import type { PasswordPromptResult } from "../password"
import { type SpawnOptions, spawnSSH } from "./connection"
import type { SessionState } from "./state"

/**
 * Connect with a password typed in the OpenCode dialog.
 *
 * There is no key, agent, or retry path: the password is asked for on every connect,
 * and a cancellation stops the connect instead of silently falling back.
 */
export async function connectWithPassword(
  state: SessionState,
  host: string,
  options: string | undefined,
  signal: AbortSignal | undefined,
  askpass: string | undefined,
  askPassword: ((host: string) => Promise<PasswordPromptResult>) | undefined,
): Promise<string> {
  if (!askpass) {
    throw new Error(
      "Missing the bundled askpass helper (scripts/askpass.exe). It ships with the plugin; " +
        "rebuild it with scripts/build-askpass.ps1 if your copy lacks it.",
    )
  }

  if (!askPassword) {
    throw new Error("No password dialog is available. Open this plugin in the TUI or the app UI.")
  }

  const password = await askPassword(host)

  if (password === undefined) {
    throw new Error("No password dialog is available. Open this plugin in the TUI or the app UI.")
  }
  if (password === null) {
    throw new Error("Password entry was cancelled.")
  }

  const spawnOptions: SpawnOptions = { password, askpass }
  return await spawnSSH(state, host, options, signal, spawnOptions)
}

import { sendMarkerCommand, waitForMarker } from "./commands"
import { startErrorReader, startReader } from "./reader"
import type { SessionState } from "./state"

/**
 * Flags that may be passed through `ssh_connect` options.
 *
 * Only flags that cannot run a local command are allowed. In particular `-o` is
 * excluded because options such as `ProxyCommand`, `LocalCommand`, or
 * `PermitLocalCommand` execute arbitrary commands on the machine running
 * OpenCode. `-F` is excluded for the same reason: an arbitrary config file can
 * smuggle those options in. Anything else belongs in `~/.ssh/config`.
 */
const SAFE_OPTION_FLAGS = new Set(["-p", "-l", "-i", "-J"])

export function parseExtraOptions(raw: string): string[] {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const parsed: string[] = []

  for (let index = 0; index < tokens.length; index++) {
    const flag = tokens[index]
    if (!SAFE_OPTION_FLAGS.has(flag)) {
      throw new Error(
        `Unsupported SSH option '${flag}'. Allowed flags: ${[...SAFE_OPTION_FLAGS].join(", ")}. ` +
          "Add other settings to ~/.ssh/config and connect using the Host alias instead.",
      )
    }

    const value = tokens[index + 1]
    if (value === undefined) {
      throw new Error(`SSH option '${flag}' requires a value.`)
    }

    parsed.push(flag, value)
    index++
  }

  return parsed
}

export interface SpawnOptions {
  /**
   * Path to an `SSH_ASKPASS`-compatible program. Only used when a password was
   * collected (or `allowAskpass` is set); otherwise the first attempt stays
   * non-interactive and only tries keys and the agent.
   */
  askpass?: string
  /**
   * Password already collected from the user. It is handed to the askpass program
   * through the environment instead of showing another prompt.
   */
  password?: string
  /** Let the askpass program prompt on its own when no password was collected. */
  allowAskpass?: boolean
}

/**
 * Spawn an SSH process and perform the initial handshake.
 */
export async function spawnSSH(
  state: SessionState,
  host: string,
  options?: string,
  signal?: AbortSignal,
  spawnOptions: SpawnOptions = {},
): Promise<string> {
  const sshArgs = ["ssh", "-T"]

  const interactive = Boolean(spawnOptions.password) || spawnOptions.allowAskpass === true

  if (interactive) {
    // No TTY and no interactive stdin are available here, so OpenSSH can only
    // obtain a secret through SSH_ASKPASS.
    sshArgs.push("-o", "NumberOfPasswordPrompts=1")
  } else {
    sshArgs.push("-o", "BatchMode=yes")
  }

  sshArgs.push(
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=60",
    "-o",
    "ServerAliveCountMax=3",
  )

  if (options) {
    sshArgs.push(...parseExtraOptions(options))
  }

  sshArgs.push(host, "bash", "-l")

  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("SSH operation aborted.")
  }

  const env =
    interactive && spawnOptions.askpass
      ? {
          ...process.env,
          SSH_ASKPASS: spawnOptions.askpass,
          SSH_ASKPASS_REQUIRE: "force",
          ...(spawnOptions.password ? { OC_SSH_PASSWORD: spawnOptions.password } : {}),
        }
      : process.env

  state.proc = Bun.spawn(sshArgs, {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // The OpenCode service runs without a console; without this every ssh child gets
    // its own console window on Windows.
    windowsHide: true,
  })
  state.host = host
  state.buffer = ""
  state.stderr = ""
  state.readerDone = false

  const stderrDone = startErrorReader(state, state.proc.stderr as ReadableStream<Uint8Array>)
  startReader(state, state.proc.stdout as ReadableStream<Uint8Array>)

  // initial handshake: consume any MOTD/banner
  const handshakeId = Math.random().toString(36).substring(2, 10)
  sendMarkerCommand(state, "true", handshakeId)

  try {
    await waitForMarker(state, handshakeId, 30000, signal)
    state.connectedAt = Date.now()
  } catch (err) {
    killSSH(state)
    await stderrDone
    const errorMsg = state.stderr.trim() || (err instanceof Error ? err.message : String(err))
    const hint = /Permission denied \(publickey/i.test(errorMsg)
      ? "\nNo usable SSH key was offered. Install one with `ssh-copy-id`, or set the plugin `askpass` option to get a password prompt."
      : ""
    throw new Error(`Failed to establish SSH session to ${host}: ${errorMsg}${hint}`)
  }

  return `Connected to ${host}. Shell state will persist between commands.`
}

/**
 * Kill the SSH process and reset all state.
 */
export function killSSH(state: SessionState): string {
  const prevHost = state.host

  state.pendingReject?.(new Error("SSH connection closed."))
  if (state.proc) {
    try {
      state.proc.kill()
    } catch {
      // ignore kill errors
    }
  }

  state.proc = null
  state.host = null
  state.connectedAt = null
  state.buffer = ""
  state.readerDone = true
  state.pendingResolve = null
  state.pendingReject = null
  state.currentMarkerId = ""
  return prevHost ? `Disconnected from ${prevHost}.` : "No active SSH session."
}

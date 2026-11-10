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

/**
 * Split an option string into shell-like tokens, honouring single quotes, double
 * quotes and backslash escapes.
 *
 * A plain whitespace split used to break every value that contains a space, which
 * on Windows is the normal case for a private key path.
 */
export function tokenizeOptions(raw: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  let started = false

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]

    // A backslash only escapes quotes, whitespace and another backslash, so a
    // Windows path such as "C:\Users\me\.ssh\id_rsa" keeps its separators.
    if (char === "\\" && quote !== "'") {
      const next = raw[index + 1]
      if (next !== undefined && /["'\\\s]/.test(next)) {
        current += next
        index++
      } else {
        current += char
      }
      started = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      started = true
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ""
        started = false
      }
      continue
    }

    current += char
    started = true
  }

  if (quote) throw new Error(`Unterminated ${quote} quote in SSH options.`)
  if (started) tokens.push(current)
  return tokens
}

export function parseExtraOptions(raw: string): string[] {
  const tokens = tokenizeOptions(raw.trim()).filter(Boolean)
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

/**
 * Reject anything that could be read as an `ssh` flag instead of a destination.
 *
 * The host ends up in argv next to the command, so a value such as
 * `-oProxyCommand=...` would be parsed as an option by OpenSSH. Rejecting it here
 * keeps the plugin's argument list from ever becoming an option injection, no
 * matter how the rest of the argv is ordered later.
 */
export function validateHost(host: string): string {
  const value = typeof host === "string" ? host.trim() : ""

  if (!value) throw new Error("`host` must not be empty.")
  if (value.startsWith("-")) {
    throw new Error(
      `Invalid SSH host '${value}': a host must not start with '-' (it would be parsed as an ssh option).`,
    )
  }
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x20 || code === 0x7f) {
      throw new Error(
        `Invalid SSH host '${value}': it must not contain whitespace or control characters.`,
      )
    }
  }
  if (value.length > 512) {
    throw new Error("Invalid SSH host: it is longer than 512 characters.")
  }

  return value
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
  const destination = validateHost(host)
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

  sshArgs.push(destination, "bash", "-l")

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
  state.host = destination
  state.options = options ?? ""
  state.buffer = ""
  state.stderr = ""
  state.framed = false
  state.desynced = false
  state.readerDone = false

  const stderrDone = startErrorReader(state, state.proc.stderr as ReadableStream<Uint8Array>)
  state.readerPromise = startReader(state, state.proc.stdout as ReadableStream<Uint8Array>)

  // initial handshake: consume any MOTD/banner
  const handshakeId = Math.random().toString(36).substring(2, 10)
  sendMarkerCommand(state, "true", handshakeId)

  try {
    await waitForMarker(state, handshakeId, 30000, signal)
    state.connectedAt = Date.now()
  } catch (err) {
    killSSH(state)
    // Both readers must be finished before the state can be reused by a retry,
    // otherwise the old reader marks the new session as dropped.
    await Promise.all([stderrDone, state.readerPromise ?? Promise.resolve()])
    const errorMsg = state.stderr.trim() || (err instanceof Error ? err.message : String(err))
    const hint = /Permission denied \(publickey/i.test(errorMsg)
      ? "\nNo usable SSH key was offered. Install one with `ssh-copy-id`, or set the plugin `askpass` option to get a password prompt."
      : ""
    throw new Error(`Failed to establish SSH session to ${destination}: ${errorMsg}${hint}`)
  }

  return `Connected to ${destination}. Shell state will persist between commands.`
}

/**
 * Kill the SSH process and reset all state.
 */
export function killSSH(state: SessionState): string {
  const prevHost = state.host

  const reject = state.pendingReject
  state.pendingReject = null
  state.pendingResolve = null
  state.currentMarkerId = ""
  reject?.(new Error("SSH connection closed."))

  if (state.proc) {
    try {
      state.proc.kill()
    } catch {
      // ignore kill errors
    }
  }

  state.proc = null
  state.host = null
  state.options = ""
  state.connectedAt = null
  state.buffer = ""
  state.framed = false
  state.desynced = true
  state.readerDone = true
  return prevHost ? `Disconnected from ${prevHost}.` : "No active SSH session."
}

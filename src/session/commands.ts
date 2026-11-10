import { MARKER_BEGIN_PREFIX, MARKER_PREFIX, MARKER_SUFFIX, newMarkerId } from "./marker"
import { checkBuffer } from "./reader"
import type { SessionState } from "./state"

/**
 * Write a framed command to the SSH process stdin.
 *
 * The frame is: begin marker, the command, done marker. The command runs inside a
 * block whose stdin is `/dev/null`, because otherwise any command that reads stdin
 * (`cat`, `head`, `read`, `python3`, `sudo`, ...) consumes the marker line and the
 * session hangs until the timeout fires.
 *
 * The block is a `{ ...; }` group, not a subshell, so `cd` and exported variables
 * keep affecting the rest of the session.
 */
export function sendMarkerCommand(state: SessionState, command: string, id: string): void {
  const stdin = state.proc?.stdin as { write(data: string): number; flush(): void } | undefined
  if (!stdin) throw new Error("The SSH session is closed. Reconnect with ssh_connect.")

  const body = command.trim() ? command : "true"

  // Anything still buffered belongs to the previous frame; dropping it here keeps a
  // stale line from being attributed to the command that is about to run.
  state.buffer = ""
  state.framed = false
  state.currentMarkerId = id

  const payload =
    `printf '%s\\n' '${MARKER_BEGIN_PREFIX}${id}${MARKER_SUFFIX}'\n` +
    `{ ${body}\n} < /dev/null 2>&1\n` +
    `__oc_ec=$?\n` +
    `printf '%s\\n' "${MARKER_PREFIX}${id}_\${__oc_ec}${MARKER_SUFFIX}"\n`

  stdin.write(payload)
  stdin.flush()
}

/**
 * Wait for the done marker of the current frame, with a timeout.
 *
 * A timeout leaves the stream in an unknown state (the remote command is still
 * running and its output would land in the next frame), so the session is marked
 * desynced: it has to be recreated before it can be used again.
 */
export async function waitForMarker(
  state: SessionState,
  id: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>

    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (state.currentMarkerId !== id) return
      state.pendingResolve = null
      state.pendingReject = null
      state.currentMarkerId = ""
    }
    const complete =
      <T>(callback: (value: T) => void) =>
      (value: T) => {
        if (settled) return
        settled = true
        cleanup()
        callback(value)
      }
    const fail = (error: Error) => {
      state.desynced = true
      state.framed = false
      state.buffer = ""
      complete(reject)(error)
    }
    const onAbort = () => {
      const reason = signal?.reason
      fail(reason instanceof Error ? reason : new Error("SSH operation aborted."))
    }

    state.currentMarkerId = id
    state.pendingResolve = complete(resolve)
    state.pendingReject = fail
    timer = setTimeout(() => {
      if (state.currentMarkerId === id) {
        state.pendingReject?.(new Error(`Command timed out after ${timeout}ms`))
      }
    }, timeout)
    signal?.addEventListener("abort", onAbort, { once: true })

    if (signal?.aborted) {
      onAbort()
      return
    }
    checkBuffer(state)
  })
}

/** Run a command and return its output together with the exit code. */
export async function executeCommandResult(
  state: SessionState,
  command: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<{ output: string; exitCode: number }> {
  if (!isAlive(state)) throw new Error("No active SSH session. Use ssh_connect first.")
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("SSH operation aborted.")
  }

  const id = newMarkerId()
  sendMarkerCommand(state, command, id)
  return waitForMarker(state, id, timeout, signal)
}

/**
 * Execute a command on the active SSH session and return its output.
 *
 * The exit code is appended to the text (tool output contract, unchanged from
 * earlier versions); internal callers that need the code use `executeCommandResult`.
 */
export async function executeCommand(
  state: SessionState,
  command: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!isAlive(state)) {
    return "No active SSH session. Use ssh_connect to establish a connection first."
  }

  const result = await executeCommandResult(state, command, timeout, signal)

  if (result.exitCode !== 0) {
    return `${result.output}\n[exit code: ${result.exitCode}]`
  }
  return result.output
}

/**
 * Check if the SSH process is alive and its stream is still trustworthy.
 */
export function isAlive(state: SessionState | undefined): boolean {
  return state?.proc != null && !state.readerDone && !state.desynced
}

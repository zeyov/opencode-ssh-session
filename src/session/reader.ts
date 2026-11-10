import { beginMarkerRegex, markerRegex } from "./marker"
import type { SessionState } from "./state"

/** Hard cap on a single command's captured output, so a runaway command cannot exhaust memory. */
export function maxOutputCharacters(): number {
  const configured = Number(process.env.OC_SSH_MAX_OUTPUT)
  return Number.isFinite(configured) && configured > 0 ? configured : 512 * 1024 * 1024
}

/**
 * Look for a complete frame in the buffer.
 *
 * Bytes before the begin marker belong to a previous command (a background job, a
 * late flush, ...) and are discarded, so one command can never be handed another
 * command's output. If the begin marker never shows up but a done marker does (an
 * older peer or a shell that died mid-frame), the legacy "everything before done"
 * reading is kept instead of hanging.
 */
export function checkBuffer(state: SessionState): void {
  if (!state.currentMarkerId || !state.pendingResolve) return

  const id = state.currentMarkerId

  if (!state.framed) {
    const begin = state.buffer.match(beginMarkerRegex(id))
    if (begin) {
      const index = state.buffer.indexOf(begin[0])
      state.buffer = state.buffer.substring(index + begin[0].length)
      state.framed = true
    }
  }

  const match = state.buffer.match(markerRegex(id))
  if (!match) return

  const markerIndex = state.buffer.indexOf(match[0])
  const output = state.buffer.substring(0, markerIndex)
  state.buffer = state.buffer.substring(markerIndex + match[0].length)
  const exitCode = parseInt(match[1], 10)
  state.pendingResolve({ output: output.trim(), exitCode })
}

export async function startErrorReader(
  state: SessionState,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      state.stderr = (state.stderr + decoder.decode(value, { stream: true })).slice(-65_536)
    }
  } catch {
    // stream closed or errored
  }
}

export async function startReader(
  state: SessionState,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const limit = maxOutputCharacters()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      state.buffer += decoder.decode(value, { stream: true })

      if (state.buffer.length > limit) {
        // Drop the stream: continuing would mix frames and keep buffering.
        state.buffer = ""
        state.desynced = true
        try {
          state.proc?.kill()
        } catch {
          // ignore kill errors
        }
        state.pendingReject?.(
          new Error(
            `Command output exceeded ${limit} characters. The SSH session was closed; reconnect with ssh_connect.`,
          ),
        )
        return
      }

      checkBuffer(state)
    }
    state.buffer += decoder.decode()
    checkBuffer(state)
  } catch {
    // stream closed or errored
  } finally {
    state.readerDone = true
    if (state.pendingReject) {
      state.desynced = true
      state.pendingReject(new Error("SSH connection dropped while waiting for command output."))
    }
  }
}

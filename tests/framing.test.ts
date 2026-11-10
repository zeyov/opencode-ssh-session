import { describe, expect, test } from "bun:test"
import { isAlive, sendMarkerCommand, waitForMarker } from "../src/session/commands"
import { startReader } from "../src/session/reader"
import { createState, type SessionState } from "../src/session/state"

interface Harness {
  state: SessionState
  send(text: string): void
  payload(): string
  close(): Promise<void>
}

/**
 * Drive the reader with a synthetic remote stream, so the framing rules can be
 * checked without a POSIX host or a fake `ssh` script.
 */
function harness(): Harness {
  const state = createState()
  let written = ""

  state.proc = {
    stdin: {
      write(data: string) {
        written += data
        return data.length
      },
      flush() {},
    },
    kill() {},
  } as unknown as SessionState["proc"]

  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next
    },
  })
  const reader = startReader(state, stream)
  const encoder = new TextEncoder()

  return {
    state,
    send(text) {
      controller.enqueue(encoder.encode(text))
    },
    payload() {
      return written
    },
    async close() {
      controller.close()
      await reader
    },
  }
}

function frame(payload: string, id: string): { begin: string; done: string } {
  const nonce = payload.match(/<<__OC_SSH_BEGIN__([0-9a-f]+)_/)?.[1]
  if (!nonce) throw new Error("the command was not framed")
  return {
    begin: `<<__OC_SSH_BEGIN__${nonce}_${id}>>`,
    done: `<<__OC_SSH_DONE__${nonce}_${id}_`,
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

describe("command framing", () => {
  test("discards output that arrived while the session was idle", async () => {
    const h = harness()

    // A background job from the previous command is still writing.
    h.send("LEAK_FROM_BACKGROUND\n")
    await flush()

    const id = "frame-idle"
    sendMarkerCommand(h.state, "echo hi", id)
    const pending = waitForMarker(h.state, id, 1_000)

    const { begin, done } = frame(h.payload(), id)
    h.send(`${begin}\nhi\n${done}0>>\n`)

    await expect(pending).resolves.toEqual({ output: "hi", exitCode: 0 })
    await h.close()
  })

  test("discards output that arrives between the write and the begin marker", async () => {
    const h = harness()
    const id = "frame-early"

    sendMarkerCommand(h.state, "echo hi", id)
    const pending = waitForMarker(h.state, id, 1_000)

    h.send("LEAK_BEFORE_BEGIN\n")
    const { begin, done } = frame(h.payload(), id)
    h.send(`${begin}\nhi\n${done}0>>\n`)

    await expect(pending).resolves.toEqual({ output: "hi", exitCode: 0 })
    await h.close()
  })

  test("keeps the exit code and strips the markers from the output", async () => {
    const h = harness()
    const id = "frame-exit"

    sendMarkerCommand(h.state, "false", id)
    const pending = waitForMarker(h.state, id, 1_000)
    const { begin, done } = frame(h.payload(), id)
    h.send(`${begin}\nboom\n${done}3>>\n`)

    await expect(pending).resolves.toEqual({ output: "boom", exitCode: 3 })
    await h.close()
  })

  test("still resolves a frame that has no begin marker", async () => {
    const h = harness()
    const id = "frame-legacy"

    sendMarkerCommand(h.state, "echo legacy", id)
    const pending = waitForMarker(h.state, id, 1_000)
    const { done } = frame(h.payload(), id)
    h.send(`legacy output\n${done}0>>\n`)

    await expect(pending).resolves.toEqual({ output: "legacy output", exitCode: 0 })
    await h.close()
  })

  test("marks the session desynced after a timeout", async () => {
    const h = harness()
    const id = "frame-timeout"

    sendMarkerCommand(h.state, "sleep 100", id)
    const pending = waitForMarker(h.state, id, 20)

    await expect(pending).rejects.toThrow(/timed out/)
    expect(h.state.desynced).toBe(true)
    expect(isAlive(h.state)).toBe(false)
    await h.close()
  })

  test("closes a session whose command output runs away", async () => {
    const previous = process.env.OC_SSH_MAX_OUTPUT
    process.env.OC_SSH_MAX_OUTPUT = "64"

    try {
      const h = harness()
      const id = "frame-overflow"

      sendMarkerCommand(h.state, "yes", id)
      const pending = waitForMarker(h.state, id, 5_000)
      h.send("x".repeat(1_000))

      await expect(pending).rejects.toThrow(/exceeded/)
      expect(isAlive(h.state)).toBe(false)
      await h.close()
    } finally {
      if (previous === undefined) delete process.env.OC_SSH_MAX_OUTPUT
      else process.env.OC_SSH_MAX_OUTPUT = previous
    }
  })

  test("refuses to write to a closed session", () => {
    const state = createState()
    expect(() => sendMarkerCommand(state, "echo hi", "closed")).toThrow(/closed/)
  })
})

export interface SessionState {
  proc: ReturnType<typeof Bun.spawn> | null
  host: string | null
  /** Extra `ssh` flags the session was opened with, used to detect changed options. */
  options: string
  connectedAt: number | null
  buffer: string
  stderr: string
  pendingResolve: ((result: { output: string; exitCode: number }) => void) | null
  pendingReject: ((error: Error) => void) | null
  currentMarkerId: string
  /** Set once the begin marker of the running command has been consumed. */
  framed: boolean
  /**
   * Set when the stream can no longer be trusted (timeout, output overflow, dropped
   * connection). A desynced state is never reused: the next call reports a closed
   * session instead of returning somebody else's output.
   */
  desynced: boolean
  running: boolean
  commandQueue: Array<() => void>
  readerDone: boolean
  /** Settles when the stdout reader loop has finished. */
  readerPromise: Promise<void> | null
}

export function createState(): SessionState {
  return {
    proc: null,
    host: null,
    options: "",
    connectedAt: null,
    buffer: "",
    stderr: "",
    pendingResolve: null,
    pendingReject: null,
    currentMarkerId: "",
    framed: false,
    desynced: false,
    running: false,
    commandQueue: [],
    readerDone: false,
    readerPromise: null,
  }
}

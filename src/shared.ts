import { note } from "./diag"
import { createSessionManager, type SessionManager } from "./session/manager"

export interface SharedState {
  /** SSH processes, shared by every plugin instance in this process. */
  sessions: SessionManager
  /** Duplicate transcript lines to swallow, keyed by session ID. */
  lastFeedback: Map<string, { text: string; at: number }>
  /** Set once the TUI part is reachable through RPC. */
  emitPasswordRequest: ((payload: { requestID: string; host: string }) => Promise<void>) | undefined
  /** Broadcasts the current connection so the TUI can show it. */
  publishConnection: ((host: string | null) => Promise<void>) | undefined
  /** Last known connected host, null when idle. */
  connectedHost: string | null
  /** How many plugin instances are currently set up. */
  instances: number
}

const KEY = Symbol.for("opencode-ssh-session.shared")

/**
 * The runtime can evaluate this module more than once and create a second plugin
 * instance for the same location. Anything that must stay in sync between those
 * instances is stored on `globalThis`, so commands and tools always talk to the
 * same SSH processes.
 *
 * The stored object outlives module reloads, so fields added in later versions are
 * backfilled here instead of trusting the cached shape.
 */
export const shared: SharedState = (() => {
  const store = globalThis as unknown as Record<symbol, SharedState | undefined>
  const existing = store[KEY]

  const state: SharedState = existing ?? {
    sessions: createSessionManager(),
    lastFeedback: new Map(),
    emitPasswordRequest: undefined,
    publishConnection: undefined,
    connectedHost: null,
    instances: 0,
  }

  state.lastFeedback ??= new Map()
  state.emitPasswordRequest ??= undefined
  state.publishConnection ??= undefined
  state.connectedHost ??= null
  state.instances ??= 0

  if (!existing) store[KEY] = state
  return state
})()

/** Remember the current connection and tell the TUI, so the status bar can show it. */
export function setConnected(host: string | null): void {
  if (shared.connectedHost === host) return
  shared.connectedHost = host
  note(`state: ${host ?? "(none)"} publish=${shared.publishConnection ? "yes" : "no"}`)
  void shared.publishConnection?.(host).catch(() => {})
}

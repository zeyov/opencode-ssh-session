import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import SSHSession from "../src/index"

export interface HarnessOptions {
  directory?: string
  worktree?: string
  /** Plugin options, exposed to the plugin as `ctx.options`. */
  options?: Record<string, unknown>
  /** Runs before a permission is granted; throw to simulate a rejection. */
  onAsk?: (input: PermissionInput) => void | Promise<void>
}

export interface PermissionInput {
  readonly sessionID: string
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly save?: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
}

export interface Harness {
  readonly tools: Map<string, any>
  readonly commands: Map<string, any>
  readonly asks: PermissionInput[]
  /** Synthetic transcript messages produced by commands. */
  readonly feedback: string[]
  /** Recorded session instruction entries, keyed by name. */
  readonly instructions: Map<string, unknown>
  /** Registers a permission handler that replaces the default allow-all. */
  setAsk(onAsk: HarnessOptions["onAsk"]): void
  /** Fires the `tool.execute.before` hooks. */
  guard(event: { tool: string; sessionID: string; input: unknown }): void
  /** Pushes an event into the plugin's event subscription. */
  emit(event: { type: string; data?: Record<string, unknown> }): void
  dispose(): Promise<void>
}

function eventStream() {
  const queue: Array<{ type: string; data?: Record<string, unknown> }> = []
  const waiters: Array<(value: unknown) => void> = []
  let closed = false

  return {
    iterator: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<unknown>> {
            if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() })
            if (closed) return Promise.resolve({ done: true, value: undefined })
            return new Promise((resolve) => waiters.push(resolve))
          },
          return(): Promise<IteratorResult<unknown>> {
            closed = true
            for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined })
            return Promise.resolve({ done: true, value: undefined })
          },
        }
      },
    },
    push(event: { type: string; data?: Record<string, unknown> }) {
      const waiter = waiters.shift()
      if (waiter) {
        waiter({ done: false, value: event })
      } else {
        queue.push(event)
      }
    },
    close() {
      closed = true
      for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined })
    },
  }
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), "opencode-ssh-harness-")))
  const worktree = options.worktree ?? directory
  const tools = new Map<string, any>()
  const commands = new Map<string, any>()
  const asks: PermissionInput[] = []
  const guards: Array<(event: any) => void> = []
  const feedback: string[] = []
  const instructions = new Map<string, unknown>()
  const events = eventStream()
  let onAsk = options.onAsk

  const context = {
    app: { version: "test" },
    location: {
      directory,
      project: { id: "test", directory: worktree, canonical: worktree },
    },
    options: options.options ?? {},
    tool: {
      async transform(callback: (editor: unknown) => void) {
        callback({
          add(tool: any) {
            tools.set(tool.name, tool)
          },
          remove(id: string) {
            tools.delete(id)
          },
          update() {},
          list: () => [...tools.values()],
          get: (id: string) => tools.get(id),
          namespace() {},
        })
        return { dispose: async () => {} }
      },
      async hook(_name: string, callback: (event: any) => void) {
        guards.push(callback)
        return { dispose: async () => {} }
      },
      async reload() {},
      async list() {
        return [...tools.values()]
      },
    },
    permission: {
      async assert(input: PermissionInput) {
        asks.push(input)
        await onAsk?.(input)
      },
      async hook() {
        return { dispose: async () => {} }
      },
      async list() {
        return []
      },
      async get() {
        return undefined
      },
      async reply() {},
    },
    event: {
      subscribe() {
        return events.iterator
      },
    },
    command: {
      async transform(callback: (editor: unknown) => void) {
        callback({
          add(definition: any) {
            commands.set(definition.name, definition)
          },
        })
        return { dispose: async () => {} }
      },
      async list() {
        return [...commands.values()]
      },
      async reload() {},
    },
    session: {
      async synthetic(input: { sessionID: string; text: string }) {
        feedback.push(input.text)
        return { id: `synthetic-${feedback.length}` }
      },
      instructions: {
        entry: {
          async put(input: { sessionID: string; key: string; value: unknown }) {
            instructions.set(input.key, input.value)
          },
          async remove(input: { sessionID: string; key: string }) {
            instructions.delete(input.key)
          },
          async list() {
            return [...instructions.entries()].map(([key, value]) => ({ key, value }))
          },
        },
      },
    },
  }

  const cleanup = await (
    SSHSession as unknown as { setup: (ctx: unknown) => Promise<(() => void) | void> }
  ).setup(context)

  return {
    tools,
    commands,
    asks,
    feedback,
    instructions,
    setAsk(next) {
      onAsk = next
    },
    guard(event) {
      for (const guard of guards) guard(event)
    },
    emit(event) {
      events.push(event)
    },
    async dispose() {
      events.close()
      await cleanup?.()
    },
  }
}

export function tool(harness: Harness, name: string) {
  const found = harness.tools.get(name)
  if (!found) throw new Error(`Tool '${name}' was not registered`)
  return found
}

export function toolContext(sessionID: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionID,
    agent: "build",
    messageID: `message-${sessionID}`,
    id: `call-${sessionID}`,
    signal: new AbortController().signal,
    progress: async () => {},
    ...overrides,
  } as any
}

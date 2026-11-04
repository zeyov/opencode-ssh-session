import type { Plugin } from "@opencode/plugin"

/** V2 plugin context. */
export type Context = Plugin.Context

type Editor = Parameters<Parameters<Context["tool"]["transform"]>[0]>[0]

/** A tool definition accepted by `ctx.tool.transform((editor) => editor.add(...))`. */
export type ToolDefinition = Parameters<Editor["add"]>[0]

/** Second argument the runtime passes to a tool executor. */
export type ToolExecuteContext = Parameters<ToolDefinition["execute"]>[1]

/** What a tool executor must return. */
export type ToolResult = Awaited<ReturnType<ToolDefinition["execute"]>>

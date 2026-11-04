/**
 * Minimal JSX/ambient types for the TUI host modules.
 *
 * OpenCode provides `@opentui/solid` and `solid-js` to plugin TUI parts at runtime.
 * They must NOT be installed locally: a local copy shadows the host's module and
 * loses the attached renderer ("No renderer found").
 */
declare module "@opentui/solid/jsx-runtime" {
  export const jsx: (type: unknown, props?: unknown) => unknown
  export const jsxs: (type: unknown, props?: unknown) => unknown
  export const jsxDEV: (type: unknown, props?: unknown) => unknown
  export const Fragment: (props: unknown) => unknown
}

declare namespace JSX {
  type Element = unknown
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>
  }
}

/**
 * Wire contract shared by the server part and the UI parts.
 *
 * This module has no imports on purpose: the GUI bundle may only import modules the
 * OpenCode app provides (`@opencode/plugin/gui`, `solid-js`, ...), and the server part
 * builds its definition with `Rpc.define` from `@opencode/plugin`.
 */
export const SSH_RPC_ID = "opencode-ssh-session"

export const SSH_RPC_METHODS = {
  providePassword: {
    input: {
      type: "object",
      properties: {
        requestID: { type: "string" },
        password: { type: "string" },
      },
      required: ["requestID", "password"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
      additionalProperties: false,
    },
  },
} as const

export const SSH_RPC_EVENTS = {
  requestPassword: {
    schema: {
      type: "object",
      properties: {
        requestID: { type: "string" },
        host: { type: "string" },
      },
      required: ["requestID", "host"],
      additionalProperties: false,
    },
  },
  connection: {
    schema: {
      type: "object",
      properties: {
        /** Empty string means "not connected". */
        host: { type: "string" },
      },
      required: ["host"],
      additionalProperties: false,
    },
  },
} as const

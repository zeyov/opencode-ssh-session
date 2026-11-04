import { Rpc } from "@opencode/plugin"

/**
 * Server -> TUI request for a password.
 *
 * The server cannot show UI, so it emits this event; the TUI part opens OpenCode's
 * prompt and drops the answer into the shared hand-off file (see `password-path.ts`).
 */
export const SSHPasswordRpc = Rpc.define({
  id: "opencode-ssh-session",
  methods: {},
  events: {
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
  },
})

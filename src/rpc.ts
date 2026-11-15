import { Rpc } from "@opencode/plugin"
import { SSH_RPC_EVENTS, SSH_RPC_ID, SSH_RPC_METHODS } from "./rpc-contract"

/**
 * Server <-> UI contract for the password prompt and the connection indicator.
 *
 * The server cannot show UI, so it emits `requestPassword`; the TUI or GUI part opens
 * OpenCode's dialog and answers with `providePassword`. `connection` tells the UI which
 * host is connected, for the status indicator.
 */
export const SSHPasswordRpc = Rpc.define({
  id: SSH_RPC_ID,
  methods: SSH_RPC_METHODS,
  events: SSH_RPC_EVENTS,
})

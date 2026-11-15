// @jsxImportSource solid-js
import { Plugin, Slot } from "@opencode/plugin/gui"
import { createSignal, Show } from "solid-js"
import { SSHPasswordRpc } from "./rpc"

/**
 * GUI part, used by the web UI and by OpenCode Desktop.
 *
 * The TUI has its own part; this one mirrors the same two things the terminal UI
 * shows: a `🔗 host` strip while a session is connected, and an OpenCode dialog when a
 * password is needed. The answer goes back over RPC, so it works in a browser, where
 * writing into the server's temp directory is not possible.
 */
export default Plugin.define({
  setup(ctx) {
    const [host, setHost] = createSignal<string | null>(null)
    const rpc = ctx.client.rpc(SSHPasswordRpc)

    const offConnection = rpc.events.on("connection", (event) => {
      const next = String(event.data.host ?? "")
      setHost(next.length > 0 ? next : null)
    })

    const offPassword = rpc.events.on("requestPassword", (event) => {
      const requestID = String(event.data.requestID ?? "")
      const label = String(event.data.host ?? "")
      if (!requestID) return

      const [value, setValue] = createSignal("")

      const handle = ctx.dialogs.open((dialog) => {
        const submit = (password: string) => {
          dialog.close()
          if (!password) return
          void rpc.providePassword({ requestID, password }).catch(() => {})
        }

        return (
          <ctx.ui.Dialog
            title="SSH 密码"
            description={label}
            footer={
              <>
                <ctx.ui.Button variant="ghost" onClick={() => dialog.close()}>
                  取消
                </ctx.ui.Button>
                <ctx.ui.Button variant="contrast" onClick={() => submit(value())}>
                  连接
                </ctx.ui.Button>
              </>
            }
          >
            <ctx.ui.TextInput
              label="密码"
              type="password"
              value={value()}
              onInput={setValue}
              onSubmit={submit}
            />
          </ctx.ui.Dialog>
        )
      })

      void handle
    })

    ctx.add(Slot, {
      at: "window.bottom",
      order: 100,
      render: () => (
        <Show when={host()}>
          <div style={{ padding: "2px 12px", "font-size": "12px", opacity: 0.8 }}>🔗 {host()}</div>
        </Show>
      ),
    })

    return () => {
      offConnection()
      offPassword()
    }
  },
})

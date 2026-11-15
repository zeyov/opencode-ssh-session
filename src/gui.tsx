// @jsxImportSource solid-js
import { Plugin, Slot } from "@opencode/plugin/gui"
import { createSignal, Show } from "solid-js"
import { NOTICE_SOURCE } from "./notice"
import { SSHPasswordRpc } from "./rpc"

/** Only the fields this part reads from an inbox item. */
interface InboxItem {
  readonly type?: string
  readonly payload?: {
    readonly text?: string
    readonly metadata?: Record<string, unknown>
  }
}

/**
 * GUI part, used by the web UI and by OpenCode Desktop.
 *
 * It mirrors what the TUI part shows: command feedback (a toast, or a dialog for
 * status results), a `🔗 host` strip while a session is connected, and an OpenCode
 * dialog when a password is needed. Answers go back over RPC, which a browser tab can
 * use; the TUI keeps its file hand-off.
 */
export default Plugin.define({
  setup(ctx) {
    const [host, setHost] = createSignal<string | null>(null)
    const rpc = ctx.client.rpc(SSHPasswordRpc)
    const controller = new AbortController()

    const offConnection = rpc.events.on("connection", (event) => {
      const next = String(event.data.host ?? "")
      setHost(next.length > 0 ? next : null)
    })

    const offPassword = rpc.events.on("requestPassword", (event) => {
      const requestID = String(event.data.requestID ?? "")
      const label = String(event.data.host ?? "")
      if (!requestID) return

      const [value, setValue] = createSignal("")

      ctx.dialogs.open((dialog) => {
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
    })

    // Command feedback travels as a synthetic session message, the same source the TUI
    // part listens to.
    void (async () => {
      try {
        for await (const event of ctx.client.event.subscribe({
          types: ["session.inbox.enqueued"],
          signal: controller.signal,
        })) {
          const item = (event.data as { item?: InboxItem }).item
          if (!item || item.type !== "synthetic") continue
          if (item.payload?.metadata?.source !== NOTICE_SOURCE) continue

          const text = String(item.payload.text ?? "").trim()
          if (!text) continue

          if (item.payload?.metadata?.kind === "status") {
            ctx.dialogs.open((dialog) => (
              <ctx.ui.Dialog
                title="SSH 状态"
                footer={
                  <ctx.ui.Button variant="contrast" onClick={() => dialog.close()}>
                    关闭
                  </ctx.ui.Button>
                }
              >
                <div style={{ "white-space": "pre-wrap", "line-height": "1.5" }}>{text}</div>
              </ctx.ui.Dialog>
            ))
            continue
          }

          ctx.toast.show({
            title: text,
            variant: text.startsWith("❌")
              ? "error"
              : text.startsWith("✅")
                ? "success"
                : "default",
          })
        }
      } catch {
        // Aborted on unload, or the stream is unavailable.
      }
    })()

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
      controller.abort()
      offConnection()
      offPassword()
    }
  },
})

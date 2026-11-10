// @jsxImportSource @opentui/solid

import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { Plugin } from "@opencode/plugin/tui"
import { note } from "../src/diag"
import { NOTICE_SOURCE } from "../src/notice"
import { passwordPath } from "../src/password-path"
import { SSHPasswordRpc } from "../src/rpc"

type Context = Plugin.Context

type Variant = "info" | "success" | "warning" | "error"

const STATUS_SLOTS = ["prompt.footer.status", "home.footer.status"] as const

function variantOf(text: string): Variant {
  if (text.startsWith("✅")) return "success"
  if (text.startsWith("❌")) return "error"
  if (text.startsWith("⚠️")) return "warning"
  return "info"
}

/**
 * TUI part.
 *
 * - Command feedback: mirrored from the session inbox as a toast.
 * - Passwords: an RPC event opens OpenCode's prompt, the answer goes back through a
 *   short-lived file (the RPC reply path is rejected by the server).
 * - Status bar: an RPC event carries the connected host and a footer slot renders it.
 *
 * Everything is guarded: if a piece is unavailable it is skipped, never fatal.
 */
const plugin = {
  id: "opencode-ssh-session.tui",
  async setup(ctx: Context) {
    const teardown: Array<() => void> = []
    note("tui: setup")

    try {
      const off = ctx.data.on("session.inbox.enqueued", (event) => {
        try {
          const data = event.data
          const item = data?.item
          if (!item || item.type !== "synthetic") return
          if (item.payload?.metadata?.source !== NOTICE_SOURCE) return

          const text = String(item.payload.text ?? "").trim()
          if (!text) return

          if (item.payload?.metadata?.kind === "status") {
            void ctx.ui.dialog.alert({ title: "SSH 状态", message: text }).catch(() => {})
            return
          }

          ctx.ui.toast.show({
            message: text,
            variant: variantOf(text),
            duration: 6_000,
            sessionID: data.sessionID,
          })
        } catch {
          // Never let a toast failure surface in the UI.
        }
      })
      teardown.push(off)
    } catch {
      // No event stream: skip toasts.
    }

    let claims: Array<() => void> = []
    let renderErrorNoted = false

    /**
     * The footer slot lives in the prompt view, next to OpenCode's own status text.
     * JSX here is compiled against the host's `@opentui/solid`, so the elements bind
     * to the host renderer.
     */
    const renderHost = (host: string | null) => {
      note(`tui: connection event -> ${host ?? "(none)"}`)
      for (const dispose of claims) {
        try {
          dispose()
        } catch {
          // Ignore.
        }
      }
      claims = []
      if (!host) return

      for (const slot of STATUS_SLOTS) {
        try {
          const dispose = ctx.ui.slot({
            append: slot,
            render: () => {
              try {
                return (
                  <box flexDirection="row" gap={1} flexShrink={0}>
                    <text>🔗 {host}</text>
                  </box>
                ) as never
              } catch (error) {
                if (!renderErrorNoted) {
                  renderErrorNoted = true
                  note(
                    `tui: render failed: ${error instanceof Error ? error.message : String(error)}`,
                  )
                }
                return null as never
              }
            },
          })
          claims.push(dispose)
          note(`tui: slot ${slot} claimed`)
        } catch (error) {
          note(
            `tui: slot ${slot} failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }

    try {
      const rpc = ctx.client.rpc(SSHPasswordRpc)

      const offPassword = rpc.events.on("requestPassword", async (event) => {
        const requestID = String(event.data.requestID ?? "")
        if (!requestID) return

        try {
          const value = await ctx.ui.dialog.prompt({
            title: "SSH 密码",
            description: String(event.data.host ?? ""),
            placeholder: "输入后回车确认，Esc 取消",
          })

          if (typeof value !== "string" || value.length === 0) {
            // Nothing usable. Another TUI instance may still answer, so leave the
            // hand-off file untouched; the server falls back on timeout.
            note("tui: prompt returned nothing, leaving the answer to others")
            return
          }

          const file = passwordPath(requestID)
          await mkdir(dirname(file), { recursive: true })
          // Write aside and rename: the server polls this path every 150 ms and must
          // never observe a partially written password.
          const part = `${file}.part`
          await writeFile(part, value, { mode: 0o600 })
          await rename(part, file)
        } catch {
          // Cancelled or unavailable: the server falls back to its askpass.
        }
      })
      teardown.push(offPassword)

      const offConnection = rpc.events.on("connection", async (event) => {
        try {
          const host = String(event.data.host ?? "")
          renderHost(host.length > 0 ? host : null)
        } catch {
          // Ignore.
        }
      })
      teardown.push(offConnection)
    } catch {
      // No RPC: passwords fall back to askpass, and no status bar.
    }

    return () => {
      for (const dispose of claims) {
        try {
          dispose()
        } catch {
          // Ignore.
        }
      }
      claims = []
      for (const stop of teardown) {
        try {
          stop()
        } catch {
          // Ignore teardown errors.
        }
      }
    }
  },
}

export default plugin

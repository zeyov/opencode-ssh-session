import { NOTICE_SOURCE } from "../notice"
import { askpassOf } from "../options"
import { requestPassword } from "../password"
import type { Context } from "../plugin-types"
import { spawnWithPasswordFallback } from "../session/auth"
import { executeCommand, isAlive } from "../session/commands"
import { validateHost } from "../session/connection"
import type { SessionManager } from "../session/manager"
import { withMutex } from "../session/mutex"
import { setConnected, shared } from "../shared"

/** Key of the instruction entry that tells the model what the SSH session is doing. */
const STATE_KEY = "ssh-session"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Last transcript line per session, used to swallow duplicate deliveries. */
const lastFeedback = shared.lastFeedback

const DUPLICATE_WINDOW_MS = 1_500

async function currentState(ctx: Context, sessionID: string): Promise<unknown> {
  try {
    const entries = await ctx.session.instructions.entry.list({ sessionID })
    return entries.find((entry) => entry.key === STATE_KEY)?.value
  } catch {
    return undefined
  }
}

/**
 * Show the result in the transcript without starting a model turn, and record what
 * the session is connected to so the next turn already knows.
 *
 * `memory` is the new instruction value, or `null` to clear it. The entry is only
 * written when it actually changes, so repeated status checks do not keep
 * re-announcing the same state.
 */
async function report(
  ctx: Context,
  sessionID: string,
  text: string,
  memory?: string | null,
  kind?: "status",
): Promise<void> {
  // Feedback first: if the instruction bookkeeping ever stalls, the user must still
  // see what happened. Duplicate deliveries from multiple plugin instances are
  // dropped by a short window on identical text.
  const now = Date.now()
  const last = lastFeedback.get(sessionID)
  if (!(last && last.text === text && now - last.at < DUPLICATE_WINDOW_MS)) {
    lastFeedback.set(sessionID, { text, at: now })
    try {
      await ctx.session.synthetic({
        sessionID,
        text,
        delivery: "steer",
        resume: false,
        metadata: kind ? { source: NOTICE_SOURCE, kind } : { source: NOTICE_SOURCE },
      })
    } catch {
      // Never let feedback break the command.
    }
  }

  if (memory === undefined) return

  try {
    await Promise.race([
      (async () => {
        const previous = await currentState(ctx, sessionID)
        if (memory === null) {
          if (previous !== undefined) {
            await ctx.session.instructions.entry.remove({ sessionID, key: STATE_KEY })
          }
        } else if (previous !== memory) {
          await ctx.session.instructions.entry.put({ sessionID, key: STATE_KEY, value: memory })
        }
      })(),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ])
  } catch {
    // The session may already be gone; the transcript message still matters.
  }
}

function parseArguments(
  text: string,
  command: string,
): { host: string; password?: string; options?: string } {
  const rest = text
    .trim()
    .replace(new RegExp(`^/?${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    .trim()

  if (!rest) return { host: "" }

  const tokens = rest.split(/\s+/)
  const host = tokens.shift() as string

  // `/ssh-connect host password -p 2222`: a bare second word is the password,
  // anything starting with "-" belongs to the ssh flags.
  let password: string | undefined
  if (tokens.length > 0 && !tokens[0].startsWith("-")) {
    password = tokens.shift()
  }

  return { host, password, options: tokens.length > 0 ? tokens.join(" ") : undefined }
}

export async function registerCommands(ctx: Context, sessions: SessionManager): Promise<void> {
  await ctx.command.transform((editor) => {
    editor.add({
      name: "ssh-connect",
      description: "Connect to a remote host over SSH",
      async execute({ sessionID, prompt }) {
        const parsed = parseArguments(prompt.text, "ssh-connect")
        const { password, options } = parsed
        if (!parsed.host) {
          await report(ctx, sessionID, "用法：/ssh-connect <host> [密码] [-p 端口] [-i 私钥]")
          return
        }

        let host: string
        try {
          host = validateHost(parsed.host)
        } catch (error) {
          await report(ctx, sessionID, `❌ ${errorMessage(error)}`)
          return
        }

        if (password && !askpassOf(ctx)) {
          await report(
            ctx,
            sessionID,
            "❌ 没有配置 askpass，密码无法交给 ssh。请在 opencode.json 的插件 options 里设置 askpass。",
            "SSH: not connected.",
          )
          return
        }

        try {
          await ctx.permission.assert({
            sessionID,
            action: "ssh_connect",
            resources: [host],
            save: [host],
          })
        } catch (error) {
          await report(
            ctx,
            sessionID,
            `❌ 已取消：连接权限被拒绝（${errorMessage(error)}）`,
            `SSH: not connected (permission denied).`,
          )
          return
        }

        let state = sessions.get(sessionID)
        if (isAlive(state)) state = sessions.replace(sessionID)

        try {
          await withMutex(state, () =>
            spawnWithPasswordFallback(
              state,
              host,
              options,
              undefined,
              { askpass: askpassOf(ctx) },
              password ? async () => password : requestPassword,
            ),
          )
          await report(
            ctx,
            sessionID,
            `✅ 已连接 ${host}`,
            `SSH: connected to ${host}. Shell state persists between calls.`,
          )
          setConnected(host)
        } catch (error) {
          sessions.remove(sessionID)
          setConnected(null)
          await report(
            ctx,
            sessionID,
            `❌ 连接失败（${host}）：${errorMessage(error)}`,
            `SSH: not connected.`,
          )
        }
      },
    })

    editor.add({
      name: "ssh-disconnect",
      description: "Close the persistent SSH session",
      async execute({ sessionID }) {
        const host = sessions.peek(sessionID)?.host ?? null
        const message = sessions.remove(sessionID)
        const connected = !message.startsWith("No active")
        lastFeedback.delete(sessionID)
        setConnected(null)
        await report(
          ctx,
          sessionID,
          connected && host
            ? `✅ 已断开 ${host}`
            : "ℹ️ 未连接 — 当前没有活动的 SSH 会话，无需断开。",
          null,
        )
      },
    })

    editor.add({
      name: "ssh-status",
      description: "Show SSH session status and verify the connection",
      async execute({ sessionID }) {
        const state = sessions.peek(sessionID)
        if (!state || !isAlive(state) || !state.host) {
          await report(
            ctx,
            sessionID,
            "未连接 — 当前没有活动的 SSH 会话。\n\n用 /ssh-connect <host> 建立连接。",
            "SSH: not connected.",
            "status",
          )
          return
        }

        const duration = state.connectedAt ? formatDuration(Date.now() - state.connectedAt) : "未知"
        const host = state.host
        let text = `已连接 ${host}\n时长：${duration}`

        try {
          const hostname = await withMutex(state, () => executeCommand(state, "hostname", 15_000))
          const uptime = await withMutex(state, () => executeCommand(state, "uptime", 15_000))
          text += `\nhostname：${hostname.trim()}\nuptime：${uptime.trim()}`
          await report(
            ctx,
            sessionID,
            text,
            `SSH: connected to ${host} (hostname ${hostname.trim()}).`,
            "status",
          )
        } catch (error) {
          await report(
            ctx,
            sessionID,
            `${text}\n验证失败：${errorMessage(error)}`,
            `SSH: connected to ${host}, verification failed.`,
            "status",
          )
        }
      },
    })
  })
}

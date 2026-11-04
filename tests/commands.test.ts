import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHarness } from "./harness"
import { type FakeSSH, installFakeSSH } from "./helpers"

let fakeSSH: FakeSSH

beforeAll(async () => {
  fakeSSH = await installFakeSSH()
})

afterAll(async () => {
  await fakeSSH.cleanup()
})

function invoke(
  harness: Awaited<ReturnType<typeof createHarness>>,
  name: string,
  text: string,
  sessionID: string,
) {
  const command = harness.commands.get(name)
  if (!command) throw new Error(`Command '${name}' was not registered`)
  return command.execute({ sessionID, prompt: { text }, delivery: "steer" })
}

describe("plugin commands", () => {
  test("registers the model-free commands", async () => {
    const harness = await createHarness()

    expect([...harness.commands.keys()].sort()).toEqual([
      "ssh-connect",
      "ssh-disconnect",
      "ssh-status",
    ])
    await harness.dispose()
  })

  test("/ssh-connect connects and tells the next turn", async () => {
    const harness = await createHarness()

    await invoke(harness, "ssh-connect", "/ssh-connect live-host -p 2222", "command-connect")

    expect(await fakeSSH.spawns()).toContain("live-host")
    expect(harness.asks.map((ask) => ask.action)).toEqual(["ssh_connect"])
    expect(harness.feedback.at(-1)).toContain("已连接 live-host")
    expect(String(harness.instructions.get("ssh-session"))).toContain("connected to live-host")
    await harness.dispose()
  })

  test("/ssh-connect reports the OpenSSH error instead of throwing", async () => {
    const harness = await createHarness()

    await invoke(harness, "ssh-connect", "/ssh-connect stderr-host", "command-error")

    expect(harness.feedback.at(-1)).toContain("Permission denied (publickey).")
    expect(String(harness.instructions.get("ssh-session"))).toContain("not connected")
    await harness.dispose()
  })

  test("/ssh-connect stops on a rejected permission", async () => {
    const harness = await createHarness()
    const before = await fakeSSH.spawns()
    harness.setAsk(() => {
      throw new Error("connection denied")
    })

    await invoke(harness, "ssh-connect", "/ssh-connect denied-host", "command-denied")

    expect(harness.feedback.at(-1)).toContain("connection denied")
    expect(await fakeSSH.spawns()).toEqual(before)
    await harness.dispose()
  })

  test("/ssh-status verifies the connection and records it", async () => {
    const harness = await createHarness()
    await invoke(harness, "ssh-connect", "/ssh-connect status-host", "command-status")

    await invoke(harness, "ssh-status", "/ssh-status", "command-status")

    const last = harness.feedback.at(-1) ?? ""
    expect(last).toContain("status-host")
    expect(last).toContain("hostname")
    expect(String(harness.instructions.get("ssh-session"))).toContain("connected to status-host")
    await harness.dispose()
  })

  test("/ssh-status reports an idle session", async () => {
    const harness = await createHarness()

    await invoke(harness, "ssh-status", "/ssh-status", "command-idle")

    expect(harness.feedback.at(-1)).toContain("未连接")
    expect(harness.instructions.get("ssh-session")).toBe("SSH: not connected.")
    await harness.dispose()
  })

  test("/ssh-disconnect closes the session and clears the state", async () => {
    const harness = await createHarness()
    await invoke(harness, "ssh-connect", "/ssh-connect bye-host", "command-bye")

    await invoke(harness, "ssh-disconnect", "/ssh-disconnect", "command-bye")

    expect(harness.feedback.at(-1)).toContain("已断开 bye-host")
    expect(harness.instructions.has("ssh-session")).toBe(false)
    await Bun.sleep(25)
    expect(await fakeSSH.exits()).toContain("bye-host")
    await harness.dispose()
  })
})

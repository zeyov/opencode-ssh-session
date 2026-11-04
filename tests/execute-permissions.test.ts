import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHarness, tool, toolContext } from "./harness"
import { type FakeSSH, installFakeSSH } from "./helpers"

let fakeSSH: FakeSSH

beforeAll(async () => {
  fakeSSH = await installFakeSSH()
})

afterAll(async () => {
  await fakeSSH.cleanup()
})

describe("remote command permissions", () => {
  test("does not execute a command rejected by the native bash permission", async () => {
    const harness = await createHarness()
    const allowed = toolContext("permission-denied")
    await tool(harness, "ssh_connect").execute({ host: "permission-host" }, allowed)

    const before = await fakeSSH.commands()
    harness.setAsk(() => {
      throw new Error("permission denied")
    })

    await expect(
      tool(harness, "ssh").execute({ command: "printf should-not-run" }, allowed),
    ).rejects.toThrow("permission denied")
    expect(await fakeSSH.commands()).toEqual(before)
    expect((await tool(harness, "ssh_info").execute({}, allowed)).content).toContain(
      "Host: permission-host",
    )
    await harness.dispose()
  })

  test("asks with the exact command and host before allowed execution", async () => {
    const harness = await createHarness()
    const context = toolContext("permission-allowed")
    await tool(harness, "ssh_connect").execute({ host: "allowed-host" }, context)
    harness.asks.length = 0

    const output = await tool(harness, "ssh").execute({ command: "printf allowed" }, context)

    expect(output.content).toBe("allowed")
    expect(harness.asks).toEqual([
      {
        sessionID: "permission-allowed",
        agent: "build",
        source: {
          type: "tool",
          messageID: "message-permission-allowed",
          id: "call-permission-allowed",
        },
        action: "bash",
        resources: ["printf allowed"],
        save: ["printf allowed"],
        metadata: { host: "allowed-host" },
      },
    ])
    expect((await fakeSSH.commands()).at(-1)).toBe("allowed-host\tprintf allowed")
    await harness.dispose()
  })

  test("does not ask when there is no active connection", async () => {
    const harness = await createHarness()
    const context = toolContext("permission-disconnected")

    expect(
      (await tool(harness, "ssh").execute({ command: "printf ignored" }, context)).content,
    ).toBe("No active SSH session. Use ssh_connect to establish a connection first.")
    expect(harness.asks).toHaveLength(0)
    await harness.dispose()
  })
})

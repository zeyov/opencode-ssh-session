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

describe("SSH connection permissions", () => {
  test("rejected connection approval does not spawn SSH", async () => {
    const harness = await createHarness()
    const before = await fakeSSH.spawns()
    harness.setAsk(() => {
      throw new Error("connection denied")
    })

    await expect(
      tool(harness, "ssh_connect").execute({ host: "denied-host" }, toolContext("connect-denied")),
    ).rejects.toThrow("connection denied")
    expect(await fakeSSH.spawns()).toEqual(before)
    await harness.dispose()
  })

  test("requests host-specific approval before connecting", async () => {
    const harness = await createHarness()
    const context = toolContext("connect-allowed")

    await tool(harness, "ssh_connect").execute(
      { host: "allowed-connect-host", options: "-p 2222" },
      context,
    )

    expect(harness.asks).toEqual([
      {
        sessionID: "connect-allowed",
        agent: "build",
        source: { type: "tool", messageID: "message-connect-allowed", id: "call-connect-allowed" },
        action: "ssh_connect",
        resources: ["allowed-connect-host"],
        save: ["allowed-connect-host"],
        metadata: { host: "allowed-connect-host" },
      },
    ])
    expect(await fakeSSH.spawns()).toContain("allowed-connect-host")
    expect((await fakeSSH.arguments()).at(-1)).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ServerAliveInterval=60",
      "-o",
      "ServerAliveCountMax=3",
      "-p",
      "2222",
      "allowed-connect-host",
      "bash",
      "-l",
    ])
    await harness.dispose()
  })
})

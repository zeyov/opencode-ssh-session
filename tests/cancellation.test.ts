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

async function waitForEntry(read: () => Promise<string[]>, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await read()).includes(expected)) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${expected}`)
}

describe("SSH cancellation", () => {
  test("aborting a command closes its SSH session promptly", async () => {
    const harness = await createHarness()
    const controller = new AbortController()
    const context = toolContext("abort-command", { signal: controller.signal })

    await tool(harness, "ssh_connect").execute({ host: "abort-host" }, context)
    const operation = tool(harness, "ssh")
      .execute({ command: "block", timeout: 5_000 }, context)
      .then(
        () => "resolved",
        () => "rejected",
      )
    await Bun.sleep(25)
    controller.abort()

    const outcome = await Promise.race([operation, Bun.sleep(250).then(() => "pending")])
    await harness.dispose()

    expect(outcome).toBe("rejected")
    expect((await tool(harness, "ssh_info").execute({}, context)).content).toBe(
      "No active SSH session.",
    )
    await Bun.sleep(25)
    expect(await fakeSSH.exits()).toContain("abort-host")
  })

  test("aborting a connection attempt rejects without waiting for its timeout", async () => {
    const harness = await createHarness()
    const controller = new AbortController()
    const context = toolContext("abort-connect", { signal: controller.signal })
    const operation = tool(harness, "ssh_connect")
      .execute({ host: "slow-connect" }, context)
      .then(
        () => "resolved",
        () => "rejected",
      )
    await waitForEntry(() => fakeSSH.spawns(), "slow-connect")
    controller.abort()

    const outcome = await Promise.race([operation, Bun.sleep(250).then(() => "pending")])

    expect(outcome).toBe("rejected")
    expect((await tool(harness, "ssh_info").execute({}, context)).content).toBe(
      "No active SSH session.",
    )
    await waitForEntry(() => fakeSSH.exits(), "slow-connect")
    expect(await fakeSSH.exits()).toContain("slow-connect")
  })

  test("removes abort listeners after a command completes", async () => {
    const harness = await createHarness()
    const controller = new AbortController()
    const context = toolContext("completed-command", { signal: controller.signal })

    await tool(harness, "ssh_connect").execute({ host: "completed-host" }, context)
    expect((await tool(harness, "ssh").execute({ command: "printf done" }, context)).content).toBe(
      "done",
    )
    controller.abort()
    await Bun.sleep(25)

    expect((await tool(harness, "ssh_info").execute({}, context)).content).toContain(
      "Host: completed-host",
    )
    await harness.dispose()
  })

  test("rejects when the SSH stream closes before a command completes", async () => {
    const harness = await createHarness()
    const context = toolContext("closed-stream")

    await tool(harness, "ssh_connect").execute({ host: "closed-stream-host" }, context)
    const operation = tool(harness, "ssh").execute({ command: "close", timeout: 5_000 }, context)

    await expect(operation).rejects.toThrow("SSH connection dropped")
    expect((await tool(harness, "ssh_info").execute({}, context)).content).toBe(
      "No active SSH session.",
    )
  })

  test("closes a timed-out command session", async () => {
    const harness = await createHarness()
    const context = toolContext("timed-out-command")

    await tool(harness, "ssh_connect").execute({ host: "timeout-host" }, context)
    const operation = tool(harness, "ssh").execute({ command: "block", timeout: 50 }, context)

    await expect(operation).rejects.toThrow("Command timed out after 50ms")
    expect((await tool(harness, "ssh_info").execute({}, context)).content).toBe(
      "No active SSH session.",
    )
    await Bun.sleep(75)
    expect(await fakeSSH.exits()).toContain("timeout-host")
  })

  test("disconnecting rejects the pending command exactly once", async () => {
    const harness = await createHarness()
    const context = toolContext("disconnect-command")
    let rejections = 0

    await tool(harness, "ssh_connect").execute({ host: "disconnect-host" }, context)
    const operation = tool(harness, "ssh")
      .execute({ command: "block", timeout: 100 }, context)
      .catch((error: unknown) => {
        rejections++
        throw error
      })
    await Bun.sleep(25)
    await tool(harness, "ssh_disconnect").execute({}, context)

    await expect(operation).rejects.toThrow("SSH connection closed")
    await Bun.sleep(125)
    expect(rejections).toBe(1)
  })

  test("aborting one session leaves another session operational", async () => {
    const harness = await createHarness()
    const controller = new AbortController()
    const aborted = toolContext("aborted-session", { signal: controller.signal })
    const active = toolContext("active-session")

    await tool(harness, "ssh_connect").execute({ host: "aborted-host" }, aborted)
    await tool(harness, "ssh_connect").execute({ host: "active-host" }, active)
    const operation = tool(harness, "ssh").execute({ command: "block", timeout: 5_000 }, aborted)
    await Bun.sleep(25)
    controller.abort()

    await expect(operation).rejects.toThrow()
    expect((await tool(harness, "ssh").execute({ command: "printf alive" }, active)).content).toBe(
      "alive",
    )
    await harness.dispose()
  })
})

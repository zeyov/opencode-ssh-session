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

describe("session isolation", () => {
  test("keeps connections independent across OpenCode sessions", async () => {
    const harness = await createHarness()
    const first = toolContext("session-a")
    const second = toolContext("session-b")

    await tool(harness, "ssh_connect").execute({ host: "host-a" }, first)
    await tool(harness, "ssh_connect").execute({ host: "host-b" }, second)

    expect((await tool(harness, "ssh_info").execute({}, first)).content).toContain("Host: host-a")
    expect((await tool(harness, "ssh_info").execute({}, second)).content).toContain("Host: host-b")
    expect((await tool(harness, "ssh").execute({ command: "printf host-a" }, first)).content).toBe(
      "host-a",
    )
    expect((await tool(harness, "ssh").execute({ command: "printf host-b" }, second)).content).toBe(
      "host-b",
    )

    await tool(harness, "ssh_disconnect").execute({}, first)
    expect((await tool(harness, "ssh").execute({ command: "printf host-b" }, second)).content).toBe(
      "host-b",
    )
    await harness.dispose()
  })

  test("cleans only the session named by lifecycle events", async () => {
    const harness = await createHarness()
    const first = toolContext("event-session-a")
    const second = toolContext("event-session-b")

    await tool(harness, "ssh_connect").execute({ host: "event-host-a" }, first)
    await tool(harness, "ssh_connect").execute({ host: "event-host-b" }, second)
    harness.emit({ type: "session.deleted", data: { sessionID: first.sessionID } })
    await Bun.sleep(25)

    expect((await tool(harness, "ssh_info").execute({}, first)).content).toBe(
      "No active SSH session.",
    )
    expect((await tool(harness, "ssh").execute({ command: "printf alive" }, second)).content).toBe(
      "alive",
    )
    expect(await fakeSSH.exits()).toContain("event-host-a")
    expect(await fakeSSH.exits()).not.toContain("event-host-b")
    await harness.dispose()
  })

  test("cleans every connection on plugin disposal", async () => {
    const harness = await createHarness()
    const remaining = toolContext("remaining-session")

    await tool(harness, "ssh_connect").execute({ host: "remaining-host" }, remaining)

    await harness.dispose()
    expect((await tool(harness, "ssh_info").execute({}, remaining)).content).toBe(
      "No active SSH session.",
    )
    await Bun.sleep(25)
    expect(await fakeSSH.exits()).toContain("remaining-host")
  })

  test("reports bash guard state for the calling session", async () => {
    const harness = await createHarness()
    const connected = toolContext("guard-connected")
    const disconnected = toolContext("guard-disconnected")
    await tool(harness, "ssh_connect").execute({ host: "guard-host" }, connected)

    const connectedEvent = {
      tool: "bash",
      sessionID: connected.sessionID,
      input: { command: "ssh example" },
    }
    harness.guard(connectedEvent)
    const disconnectedEvent = {
      tool: "bash",
      sessionID: disconnected.sessionID,
      input: { command: "ssh example" },
    }
    harness.guard(disconnectedEvent)

    expect(String((connectedEvent.input as { command: string }).command)).toContain(
      "active SSH session",
    )
    expect(String((disconnectedEvent.input as { command: string }).command)).toContain(
      "Use `ssh_connect`",
    )
    await harness.dispose()
  })
})

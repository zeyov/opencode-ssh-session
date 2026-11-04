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

describe("SSH connection failures", () => {
  test("returns SSH stderr without waiting for the handshake timeout", async () => {
    const harness = await createHarness()
    const context = toolContext("stderr-session")
    const startedAt = performance.now()

    await expect(
      tool(harness, "ssh_connect").execute({ host: "stderr-host" }, context),
    ).rejects.toThrow("Permission denied (publickey).")
    expect(performance.now() - startedAt).toBeLessThan(1_000)
    await harness.dispose()
  })

  test("surfaces changed host keys as connection failures", async () => {
    const harness = await createHarness()
    const context = toolContext("changed-key-session")

    await expect(
      tool(harness, "ssh_connect").execute({ host: "changed-key-host" }, context),
    ).rejects.toThrow("REMOTE HOST IDENTIFICATION HAS CHANGED!")
    await harness.dispose()
  })

  test("rejects unsafe ssh options before spawning", async () => {
    const harness = await createHarness()
    const context = toolContext("unsafe-options")
    const before = await fakeSSH.spawns()

    await expect(
      tool(harness, "ssh_connect").execute(
        { host: "x", options: "-o ProxyCommand=touch /tmp/pwn" },
        context,
      ),
    ).rejects.toThrow("Unsupported SSH option '-o'")
    await expect(
      tool(harness, "ssh_connect").execute({ host: "x", options: "-F /tmp/evil" }, context),
    ).rejects.toThrow("Unsupported SSH option '-F'")
    await expect(
      tool(harness, "ssh_connect").execute({ host: "x", options: "-p" }, context),
    ).rejects.toThrow("requires a value")

    expect(await fakeSSH.spawns()).toEqual(before)
    await harness.dispose()
  })

  test("passes safe flags through to ssh", async () => {
    const harness = await createHarness()
    const context = toolContext("safe-options")

    await tool(harness, "ssh_connect").execute(
      { host: "safe-host", options: "-p 2222 -l deploy" },
      context,
    )

    const args = (await fakeSSH.arguments()).at(-1) ?? []
    expect(args.join(" ")).toContain("-p 2222")
    expect(args.join(" ")).toContain("-l deploy")
    await harness.dispose()
  })
})

describe("commands that read stdin", () => {
  test("do not consume the output marker or kill the session", async () => {
    const harness = await createHarness()
    const context = toolContext("stdin-command")

    await tool(harness, "ssh_connect").execute({ host: "stdin-host" }, context)
    const startedAt = performance.now()

    // `cat` with no arguments reads stdin. Without the /dev/null redirect it would
    // swallow the marker line and hang until the timeout killed the session.
    expect(
      (await tool(harness, "ssh").execute({ command: "cat", timeout: 2_000 }, context)).content,
    ).toBe("")

    expect(performance.now() - startedAt).toBeLessThan(1_500)
    expect((await tool(harness, "ssh_info").execute({}, context)).content).toContain(
      "Host: stdin-host",
    )
    await harness.dispose()
  })
})

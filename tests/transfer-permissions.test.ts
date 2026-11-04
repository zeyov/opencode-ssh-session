import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHarness, tool, toolContext } from "./harness"
import { type FakeSSH, installFakeSSH } from "./helpers"

let fakeSSH: FakeSSH
let directory: string

beforeAll(async () => {
  fakeSSH = await installFakeSSH()
  directory = await mkdtemp(join(tmpdir(), "opencode-ssh-transfer-"))
})

afterAll(async () => {
  await fakeSSH.cleanup()
  await rm(directory, { recursive: true, force: true })
})

describe("file transfer permissions", () => {
  test("rejected upload performs no remote writes", async () => {
    const harness = await createHarness({ directory, worktree: directory })
    const source = join(directory, "missing-source.txt")
    const destination = join(directory, "remote.txt")
    const context = toolContext("upload-denied")
    await tool(harness, "ssh_connect").execute({ host: "upload-host" }, context)
    const before = await fakeSSH.commands()

    harness.setAsk(() => {
      throw new Error("permission denied")
    })

    await expect(
      tool(harness, "ssh_upload").execute({ localPath: source, remotePath: destination }, context),
    ).rejects.toThrow("permission denied")
    expect(await fakeSSH.commands()).toEqual(before)
    expect(await Bun.file(destination).exists()).toBe(false)
    await harness.dispose()
  })

  test("requests upload permissions before transferring bytes", async () => {
    const harness = await createHarness({ directory, worktree: directory })
    const source = join(directory, "allowed-source.bin")
    const destination = join(directory, "allowed-remote.bin")
    await writeFile(source, new Uint8Array([0, 1, 2, 255]))
    const context = toolContext("upload-allowed")
    await tool(harness, "ssh_connect").execute({ host: "upload-allowed-host" }, context)
    harness.asks.length = 0

    await tool(harness, "ssh_upload").execute(
      { localPath: source, remotePath: destination },
      context,
    )

    expect(harness.asks.map((ask) => ({ action: ask.action, resources: ask.resources }))).toEqual([
      { action: "read", resources: [source] },
      { action: "edit", resources: [`upload-allowed-host:${destination}`] },
    ])
    expect(new Uint8Array(await readFile(destination))).toEqual(new Uint8Array([0, 1, 2, 255]))
    await harness.dispose()
  })

  test("rejected download does not write the local destination", async () => {
    const harness = await createHarness({ directory, worktree: directory })
    const source = join(directory, "download-remote.txt")
    const destination = join(directory, "download-local.txt")
    await writeFile(source, "remote content")
    const context = toolContext("download-denied")
    await tool(harness, "ssh_connect").execute({ host: "download-host" }, context)
    harness.asks.length = 0
    const before = await fakeSSH.commands()

    harness.setAsk((ask) => {
      if (ask.action === "edit") throw new Error("permission denied")
    })

    await expect(
      tool(harness, "ssh_download").execute(
        { remotePath: source, localPath: destination },
        context,
      ),
    ).rejects.toThrow("permission denied")
    expect(harness.asks.map((ask) => ({ action: ask.action, resources: ask.resources }))).toEqual([
      { action: "read", resources: [`download-host:${source}`] },
      { action: "edit", resources: [destination] },
    ])
    expect(await fakeSSH.commands()).toEqual(before)
    expect(await Bun.file(destination).exists()).toBe(false)
    await harness.dispose()
  })

  test("requests external-directory access without sibling-prefix bypasses", async () => {
    const worktree = join(directory, "worktree")
    const sibling = join(directory, "worktree-other")
    await mkdir(worktree, { recursive: true })
    await mkdir(sibling, { recursive: true })
    const harness = await createHarness({ directory: worktree, worktree })
    const source = join(sibling, "source.txt")
    const destination = join(directory, "external-remote.txt")
    await writeFile(source, "external")
    const context = toolContext("external-upload")
    await tool(harness, "ssh_connect").execute({ host: "external-host" }, context)
    harness.asks.length = 0

    await tool(harness, "ssh_upload").execute(
      { localPath: source, remotePath: destination },
      context,
    )

    expect(harness.asks.map((ask) => ask.action)).toEqual(["external_directory", "read", "edit"])

    harness.asks.length = 0
    const parentSource = join(directory, "parent-source.txt")
    await writeFile(parentSource, "parent")
    await tool(harness, "ssh_upload").execute(
      { localPath: parentSource, remotePath: join(directory, "parent-remote.txt") },
      context,
    )
    expect(harness.asks.map((ask) => ask.action)).toEqual(["external_directory", "read", "edit"])
    await harness.dispose()
  })

  test("round-trips binary data after permissions are granted", async () => {
    const harness = await createHarness({ directory, worktree: directory })
    const source = join(directory, "roundtrip-source.bin")
    const remote = join(directory, "roundtrip-remote.bin")
    const destination = join(directory, "roundtrip-destination.bin")
    const bytes = new Uint8Array([0, 10, 13, 39, 127, 255])
    await writeFile(source, bytes)
    const context = toolContext("roundtrip")
    await tool(harness, "ssh_connect").execute({ host: "roundtrip-host" }, context)

    await tool(harness, "ssh_upload").execute({ localPath: source, remotePath: remote }, context)
    await tool(harness, "ssh_download").execute(
      { remotePath: remote, localPath: destination },
      context,
    )

    expect(new Uint8Array(await readFile(destination))).toEqual(bytes)
    await harness.dispose()
  })
})

import { describe, expect, test } from "bun:test"
import SSHSession, { SSHSession as namedSSHSession } from "../src/index"

describe("package exports", () => {
  test("exports a V2 plugin definition", () => {
    expect(SSHSession).toBe(namedSSHSession)
    expect(SSHSession.id).toBe("opencode-ssh-session")
    expect(typeof SSHSession.setup).toBe("function")
  })
})

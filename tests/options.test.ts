import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseExtraOptions, tokenizeOptions, validateHost } from "../src/session/connection"
import { remotePathExpr } from "../src/session/remote-path"
import { expandHome } from "../src/tools/permissions"

describe("ssh options", () => {
  test("splits on whitespace", () => {
    expect(tokenizeOptions("-p 2222 -l deploy")).toEqual(["-p", "2222", "-l", "deploy"])
  })

  test("keeps quoted values together, including Windows paths", () => {
    expect(tokenizeOptions('-i "C:\\Users\\me\\my key"')).toEqual(["-i", "C:\\Users\\me\\my key"])
    expect(tokenizeOptions("-i 'C:\\Users\\me\\my key'")).toEqual(["-i", "C:\\Users\\me\\my key"])
  })

  test("rejects an unterminated quote", () => {
    expect(() => tokenizeOptions('-i "C:\\Users\\me')).toThrow(/Unterminated/)
  })

  test("accepts the allowed flags with a value", () => {
    expect(parseExtraOptions("-p 2222")).toEqual(["-p", "2222"])
    expect(parseExtraOptions("-J jump.example -l deploy")).toEqual([
      "-J",
      "jump.example",
      "-l",
      "deploy",
    ])
  })

  test("still rejects flags that could run a local command", () => {
    expect(() => parseExtraOptions("-o ProxyCommand=touch /tmp/pwn")).toThrow(/Unsupported/)
    expect(() => parseExtraOptions("-F /tmp/evil")).toThrow(/Unsupported/)
    expect(() => parseExtraOptions("-p")).toThrow(/requires a value/)
  })
})

describe("host validation", () => {
  test("accepts the documented host forms", () => {
    expect(validateHost("user@server")).toBe("user@server")
    expect(validateHost("myalias")).toBe("myalias")
    expect(validateHost("192.168.1.10")).toBe("192.168.1.10")
    expect(validateHost("  ops@prod  ")).toBe("ops@prod")
  })

  test("rejects values that ssh would read as an option", () => {
    expect(() => validateHost("-oProxyCommand=calc.exe")).toThrow(/must not start with/)
    expect(() => validateHost("--help")).toThrow(/must not start with/)
    expect(() => validateHost("host -oProxyCommand=calc.exe")).toThrow(/whitespace/)
    expect(() => validateHost("")).toThrow(/empty/)
    expect(() => validateHost("host\nwhoami")).toThrow(/control characters/)
  })
})

describe("remote paths", () => {
  test("expands a leading tilde outside the quotes", () => {
    expect(remotePathExpr("~/notes.txt")).toBe("\"$HOME\"/'notes.txt'")
    expect(remotePathExpr("~")).toBe('"$HOME"')
  })

  test("quotes everything else", () => {
    expect(remotePathExpr("/tmp/a b.txt")).toBe("'/tmp/a b.txt'")
    expect(remotePathExpr("/tmp/it's.txt")).toBe("'/tmp/it'\"'\"'s.txt'")
  })
})

describe("local paths", () => {
  test("expands a leading tilde to the home directory", () => {
    expect(expandHome("~/notes.txt")).toBe(join(homedir(), "notes.txt"))
    expect(expandHome("~")).toBe(homedir())
  })

  test("leaves absolute and relative paths alone", () => {
    expect(expandHome("/tmp/notes.txt")).toBe("/tmp/notes.txt")
    expect(expandHome("notes.txt")).toBe("notes.txt")
  })
})

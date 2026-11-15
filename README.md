# opencode-ssh-session

Run commands on a remote Linux host through one persistent SSH session. Shell state —
working directory, exported variables — survives between tool calls.

## Install

Clone the repository into OpenCode's global plugins directory. OpenCode discovers it
there, so no configuration is needed.

```sh
git clone https://github.com/zeyov/opencode-ssh-session \
  ~/.config/opencode/plugins/opencode-ssh-session
```

```powershell
git clone https://github.com/zeyov/opencode-ssh-session "$env:USERPROFILE\.config\opencode\plugins\opencode-ssh-session"
```

Restart OpenCode afterwards. You get six tools (`ssh_connect`, `ssh`, `ssh_disconnect`,
`ssh_info`, `ssh_upload`, `ssh_download`) and three commands (`/ssh-connect`,
`/ssh-status`, `/ssh-disconnect`).

> `opencode plugin add github:...` is not supported here: OpenCode 2.3.0 runs its own CLI
> instead of npm while preparing a git dependency and rejects the npm flags, so every
> `github:` install fails. Cloning is the working path.

## Uninstall

Delete the directory and restart OpenCode.

```sh
rm -rf ~/.config/opencode/plugins/opencode-ssh-session
```

```powershell
Remove-Item "$env:USERPROFILE\.config\opencode\plugins\opencode-ssh-session" -Recurse -Force
```

If you added the plugin to a config file by path, remove that entry too. Nothing else is
written: no key, no credential, no state outside the plugin directory.

## Update

```sh
sh ~/.config/opencode/plugins/opencode-ssh-session/scripts/install.sh
```

```powershell
pwsh -File "$env:USERPROFILE\.config\opencode\plugins\opencode-ssh-session\scripts\install.ps1"
```

Both scripts clone when the directory is missing and `git pull` when it is present.
Restart OpenCode afterwards. A plain `git pull` in the directory works as well.

## Commands

| Command | What it does |
| --- | --- |
| `/ssh-connect <host> [password] [options]` | Connect and report success or the OpenSSH error |
| `/ssh-status` | Show host and uptime, verify with `hostname` and `uptime` |
| `/ssh-disconnect` | Close the session |

`password` is optional; without it the plugin asks in the OpenCode dialog. Options accept
`-p`, `-l`, `-i` and `-J` only.

## Tools

| Tool | Purpose |
| --- | --- |
| `ssh_connect` | Open the session (`host`, optional `options`) |
| `ssh` | Run a command (`command`, optional `timeout` in ms, default 120000) |
| `ssh_disconnect` | Close the session |
| `ssh_info` | Host, duration, busy state, queue length |
| `ssh_upload` | Copy a local file to the host (`localPath`, `remotePath`) |
| `ssh_download` | Copy a remote file here (`remotePath`, `localPath`) |

## Password

Every connect asks for the password in the OpenCode UI; there is no key or agent path and
nothing to configure. The plugin ships the small helper `ssh` needs to receive the secret
(`scripts/askpass.exe`), so no window ever appears. Cancelling the dialog cancels the
connect.

## Permissions

Connect, command execution and file transfers go through OpenCode's permission system.
Rules are an ordered array of `{ action, resource, effect }`; the last match wins.

```json
{
  "permissions": [
    { "action": "ssh_connect", "resource": "*", "effect": "ask" },
    { "action": "ssh_connect", "resource": "production", "effect": "deny" },
    { "action": "bash", "resource": "*", "effect": "ask" },
    { "action": "read", "resource": "*", "effect": "allow" },
    { "action": "edit", "resource": "*", "effect": "ask" },
    { "action": "external_directory", "resource": "*", "effect": "ask" }
  ]
}
```

Add `{ "action": "ssh_connect", "resource": "*", "effect": "allow" }` to skip the connect
prompt.

## Requirements

- OpenCode 2.x with plugin support
- `ssh` on the local `PATH`
- Remote: Linux with `bash`, `base64` and `wc`

## Development

```sh
bun install
bun run typecheck
bun test
bun run build      # regenerates dist/gui-experimental.cjs
```

Layout: `src/index.ts` is the server part, `src/tui.tsx` the terminal UI part,
`src/gui.tsx` the web/desktop part built into `dist/gui-experimental.cjs`. `plugin add`-style
installs read those through the `exports` in `package.json`.

## License

MIT

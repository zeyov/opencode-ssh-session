# opencode-ssh-session

An [OpenCode](https://opencode.ai) plugin that provides persistent SSH session tools. Connect to a remote host once, then run multiple commands with shell state (working directory, environment variables, etc.) preserved between calls.

## Installation

This repository is an OpenCode **V2** plugin (`@opencode/plugin`). OpenCode discovers it automatically when it is cloned into the global plugins directory, so no configuration is needed.

> `opencode plugin add github:...` is not used here: on OpenCode 2.2.5 that command fails for every GitHub package on some machines (`git dep preparation failed`), so the steps below avoid it.

### 1. Clone into the global plugins directory

```sh
mkdir -p ~/.config/opencode/plugins
git clone https://github.com/zeyov/opencode-ssh-session ~/.config/opencode/plugins/opencode-ssh-session
```

Windows (PowerShell):

```powershell
git clone https://github.com/zeyov/opencode-ssh-session "$env:USERPROFILE\.config\opencode\plugins\opencode-ssh-session"
```

### 2. Build the password helper (Windows only)

Only needed if you sign in with a password instead of a key or agent:

```powershell
pwsh -File "$env:USERPROFILE\.config\opencode\plugins\opencode-ssh-session\scripts\build-askpass.ps1"
```

The plugin finds this helper automatically. Linux and macOS users can rely on an existing helper instead — see [Passwords](#passwords).

### 3. Restart OpenCode

You should see `ssh_connect`, `ssh`, `ssh_disconnect`, `ssh_info`, `ssh_upload`, `ssh_download` in the tool list, plus the `/ssh-connect`, `/ssh-status` and `/ssh-disconnect` commands.

### Updating

```sh
cd ~/.config/opencode/plugins/opencode-ssh-session && git pull
```

Then restart OpenCode.

### Installing somewhere else

A clone outside the plugins directory has to be registered explicitly. Point `plugins` at the **`plugin` subdirectory** (not a file), in the global `~/.config/opencode/opencode.json(c)` or a project `opencode.json(c)`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-ssh-session/plugin",
      "options": { "askpass": "/absolute/path/to/askpass.exe" }
    }
  ]
}
```

Both `package` and `options.askpass` accept absolute paths; a relative `askpass` resolves against the project directory. The `askpass` option is optional — without it the plugin uses the helper bundled next to `src/`.

### Local development

Clone the repository and run OpenCode inside it. The repository ships a project-level `opencode.json` that already points at `./plugin`:

```json
{
  "plugins": [{ "package": "./plugin", "options": { "askpass": "./scripts/askpass.exe" } }]
}
```

V1 configuration (`"plugin": [...]`) is not read by V2. See the [V1 migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1).

## Permissions

The plugin asks through OpenCode's native permission system before connecting, running a remote command, or transferring files. Rules live under `permissions`, which is an ordered array of `{ action, resource, effect }`; the last matching rule wins and `effect` is `allow`, `ask`, or `deny`.

```json
{
  "permissions": [
    { "action": "ssh_connect", "resource": "*", "effect": "ask" },
    { "action": "ssh_connect", "resource": "dev-*", "effect": "allow" },
    { "action": "ssh_connect", "resource": "production", "effect": "deny" },
    { "action": "bash", "resource": "*", "effect": "ask" },
    { "action": "read", "resource": "*", "effect": "allow" },
    { "action": "edit", "resource": "*", "effect": "ask" },
    { "action": "external_directory", "resource": "*", "effect": "ask" }
  ]
}
```

Permission mapping:

| Operation | Action | Resource |
| --------- | ------ | -------- |
| Connect | `ssh_connect` | SSH host |
| Run a command | `bash` | Exact remote command |
| Upload | `read`, then `edit` | Resolved local source, then `host:remotePath` |
| Download | `read`, then `edit` | `host:remotePath`, then resolved local destination |
| Access outside the project | `external_directory` | Resolved local path |

Remote commands use the same `bash` rules as local shell commands, including agent-specific rules. A rejection aborts the operation before any SSH or filesystem work happens.

## Host verification

`ssh_connect` runs OpenSSH non-interactively. After connection approval, OpenSSH uses `StrictHostKeyChecking=accept-new`: first-time host keys are added to the user's normal known-hosts database, while changed host keys are rejected. The plugin does not bypass changed-key warnings.

By default `BatchMode=yes` is set, so only key or agent authentication can succeed. Connection errors include OpenSSH's stderr output.

### Passwords

`ssh_connect` is non-interactive: the SSH command channel owns stdin, and the plugin
runs inside the OpenCode server, so OpenSSH can only obtain a secret from an
`SSH_ASKPASS` program.

The first attempt always tries keys and the agent (`BatchMode=yes`). If OpenSSH
reports `Permission denied (publickey)`, the plugin asks once for a password:

1. With the TUI part loaded, the prompt is OpenCode's own dialog (server → TUI over
   RPC, answer handed back through a short-lived file in the temp directory).
2. Otherwise the `askpass` program shows its own prompt, about ten seconds later.

Either way the answer reaches OpenSSH through `OC_SSH_PASSWORD` and the askpass
helper, so it is never added to the transcript.

A ready-made Windows helper is included in the repository. Build it once:

```powershell
git clone https://github.com/zeyov/opencode-ssh-session
pwsh -File opencode-ssh-session/scripts/build-askpass.ps1
```

Then point the plugin at the absolute path:

```json
{
  "plugins": [
    {
      "package": "C:/Users/me/opencode-ssh-session/plugin",
      "options": { "askpass": "C:/Users/me/opencode-ssh-session/scripts/askpass.exe" }
    }
  ]
}
```

On Linux or macOS use an existing helper such as `ssh-askpass`, `ksshaskpass`, or
`x11-ssh-askpass`:

```json
{
  "plugins": [
    { "package": "/home/me/opencode-ssh-session/plugin", "options": { "askpass": "/usr/bin/ssh-askpass" } }
  ]
}
```

Installing a key once is still the cheaper path, and then nothing ever prompts:

```sh
ssh-copy-id user@host
```


## Tools

The plugin registers six tools:

### `ssh_connect`

Open a persistent SSH session to a remote host.

| Parameter | Type   | Required | Description                                              |
| --------- | ------ | -------- | -------------------------------------------------------- |
| `host`    | string | yes      | SSH host (e.g. `user@server`, `myalias`, `192.168.1.10`) |
| `options` | string | no       | Extra SSH flags (e.g. `-p 2222`, `-i ~/.ssh/mykey`)      |

`options` accepts only `-p`, `-l`, `-i`, and `-J`, each with a value. Every other flag is rejected before `ssh` starts, because flags such as `-o ProxyCommand=...` or `-F` would let a plugin call run arbitrary commands on the local machine. Put any other setting in `~/.ssh/config` and connect with the `Host` alias.

Values may be quoted when they contain spaces (`-i "C:\Users\me\my key"`). `host` must not start with `-`: the destination is passed to `ssh` next to the command, and such a value would be read as an ssh flag. A leading `~` is expanded in every path argument (`localPath`, `remotePath`, `-i`), and a session opened to the same host with different flags is reconnected instead of reused.

### `ssh`

Execute a command on the active SSH session. Shell state persists across calls.

| Parameter | Type   | Required | Description                                    |
| --------- | ------ | -------- | ---------------------------------------------- |
| `command` | string | yes      | Shell command to run on the remote host         |
| `timeout` | number | no       | Timeout in milliseconds (default: 120000 = 2m) |

### `ssh_disconnect`

Close the active SSH session. Shell state is lost. You can reconnect later with `ssh_connect`.

No parameters.

### `ssh_info`

Get the connected host, session duration, and command status for the current SSH session.

No parameters.

### `ssh_upload`

Upload a local file to the remote host through the active SSH session using base64 encoding.

| Parameter    | Type   | Required | Description                           |
| ------------ | ------ | -------- | ------------------------------------- |
| `localPath`  | string | yes      | Absolute path to the local file       |
| `remotePath` | string | yes      | Destination path on the remote host   |

### `ssh_download`

Download a file from the remote host to the local machine through the active SSH session.

| Parameter    | Type   | Required | Description                           |
| ------------ | ------ | -------- | ------------------------------------- |
| `remotePath` | string | yes      | Path to the file on the remote host   |
| `localPath`  | string | yes      | Destination path on the local machine |

## Hooks

### Bash guard (`tool.execute.before`)

Detects when the AI tries to run `ssh`, `scp`, `sftp`, or `rsync` through the built-in `bash` tool and injects a reminder to use the SSH session tools instead.

### Session cleanup (`ctx.event.subscribe`)

Closes the SSH process when an OpenCode session is deleted. Plugin unload and session errors are handled by the cleanup function returned from `setup`.

## Commands

The plugin registers three commands:

| Command | Behavior |
| ------- | -------- |
| `/ssh-connect <host> [password] [options]` | Connect, report success or the OpenSSH error |
| `/ssh-status` | Show host and connection duration, then verify with `hostname` and `uptime` |
| `/ssh-disconnect` | Close the session and clear the recorded state |

`password` is optional. When it is present the command uses it instead of prompting; note that it stays in the session transcript, so prefer the prompt or a key when that matters. A bare second word is treated as the password, anything starting with `-` is passed to `ssh`:

```
/ssh-connect ops@prod               → key or prompt
/ssh-connect ops@prod -p 2222       → key or prompt, non-default port
/ssh-connect ops@prod s3cret -p 2222
```

`ssh-connect` asks the `ssh_connect` permission, so a rule such as `{ "action": "ssh_connect", "resource": "production", "effect": "deny" }` keeps working. Add `{ "action": "ssh_connect", "resource": "*", "effect": "allow" }` to skip the prompt.

Each command reports its result through the terminal UI toast (the `./tui` part), leaves one message in the transcript, and updates a session instruction entry so the model knows the current state on its next turn.

### Skill

Copy to `.opencode/skills/` (project) or `~/.config/opencode/skills/` (global):

| Skill            | Directory                              | Description                                  |
| ---------------- | -------------------------------------- | -------------------------------------------- |
| `ssh-remote-dev` | `examples/skills/ssh-remote-dev/`      | Remote development best practices for the AI |

The skill teaches the AI patterns for deployments, debugging remote services, file transfers, and common pitfalls to avoid.

## How It Works

The plugin spawns at most one `ssh` child process for each OpenCode session and communicates with it through stdin/stdout using unique markers to delimit command output. This avoids reconnection overhead and preserves shell state between commands.

- Commands are non-interactive only (no `vim`, `top`, password prompts, etc.)
- Command stdin is `/dev/null`, so commands that read stdin return immediately instead of blocking the session
- Commands within a session execute one at a time
- Each command is framed by markers, so output that a previous command left behind (a background job, a late flush) is dropped instead of being reported as part of the next command
- Captured output is capped at 512 MiB per command; set `OC_SSH_MAX_OUTPUT` (characters) to change it. A command that exceeds the cap closes the session
- Aborting or timing out `ssh_connect` or `ssh` closes that session's SSH connection
- File transfers use base64 encoding over the existing connection
- Remote paths are shell-quoted before transfer commands run
- Session deletion and plugin shutdown clean up their associated SSH processes

## Requirements

- OpenCode 2.x with plugin support (`@opencode/plugin >= 2.2.5`)
- `ssh` available on the host machine's `PATH`

## Development

```sh
bun install
bun run typecheck
bun test
```

`bun test` uses a fake `ssh` stand-in that is a POSIX executable script, so it runs on Linux and macOS. The CI workflow runs on Ubuntu.

## License

MIT

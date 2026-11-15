# opencode-ssh-session

An [OpenCode](https://opencode.ai) plugin that provides persistent SSH session tools. Connect to a remote host once, then run multiple commands with shell state (working directory, environment variables, etc.) preserved between calls.

## Installation

This repository is an OpenCode **V2** plugin (`@opencode/plugin`). OpenCode discovers it automatically when it is cloned into the global plugins directory, so no configuration is needed.

> `opencode plugin add github:...` cannot be used: OpenCode 2.3.0 runs its own CLI instead of npm while preparing a git dependency (`Unrecognized flag: --force in command opencode`), so every `github:` package fails there. Cloning into the plugins directory is the supported path.

### 1. Clone into the global plugins directory

```sh
mkdir -p ~/.config/opencode/plugins
git clone https://github.com/zeyov/opencode-ssh-session ~/.config/opencode/plugins/opencode-ssh-session
```

Windows (PowerShell):

```powershell
git clone https://github.com/zeyov/opencode-ssh-session "$env:USERPROFILE\.config\opencode\plugins\opencode-ssh-session"
```

### 2. Restart OpenCode

You should see `ssh_connect`, `ssh`, `ssh_disconnect`, `ssh_info`, `ssh_upload`, `ssh_download` in the tool list, plus the `/ssh-connect`, `/ssh-status` and `/ssh-disconnect` commands.

There is no key setup and nothing else to configure: every connect asks for the password in the OpenCode UI.

### Updating

```powershell
pwsh -File "$env:USERPROFILE\.config\opencode\plugins\opencode-ssh-session\scripts\install.ps1"
```

```sh
sh ~/.config/opencode/plugins/opencode-ssh-session/scripts/install.sh
```

The same scripts install a missing copy, so `install.ps1`/`install.sh` also work as the first step once the repository is on disk.

### Installing somewhere else

A clone outside the plugins directory has to be registered explicitly. Point `plugins` at the **repository root** (not a file), in the global `~/.config/opencode/opencode.json(c)` or a project `opencode.json(c)`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "/absolute/path/to/opencode-ssh-session" }]
}
```

### Local development

Clone the repository and point a project config at the repository root. Keep this entry out of a project that already loads the plugin from the global plugins directory: the same plugin id loaded twice is rejected as a duplicate.

```json
{
  "plugins": [{ "package": "./" }]
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

### Passwords

Every connect asks for the password in the OpenCode UI — there is no key, agent, or
saved credential path, and nothing to configure.

The dialog is the plugin's own: the server part emits an RPC event, the TUI or GUI part
shows it, and the answer travels back. `ssh` needs a secret through `SSH_ASKPASS`
because its stdin carries the command channel, so the plugin ships a three-kilobyte
helper that only echoes `OC_SSH_PASSWORD`. It never opens a window and is already in the
repository — no build step on install.

Cancelling the dialog cancels the connect; the other password-related state is
discarded with the session.

Linux and macOS work the same way, using the same bundled helper.


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

`bun test` uses a fake `ssh` stand-in that is a POSIX executable script, so it runs on Linux and macOS.

## License

MIT

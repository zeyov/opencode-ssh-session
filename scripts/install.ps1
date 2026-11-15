# Installs the plugin from GitHub into the global OpenCode plugins directory.
#
#   pwsh -File scripts/install.ps1
#
# The plugins directory is discovered automatically, so nothing else is needed.
$ErrorActionPreference = "Stop"

$repo = "https://github.com/zeyov/opencode-ssh-session"
$plugins = Join-Path $env:USERPROFILE ".config\opencode\plugins"
$target = Join-Path $plugins "opencode-ssh-session"

if (Test-Path (Join-Path $target ".git")) {
    Write-Host "Updating $target"
    git -C $target pull --ff-only
} elseif (Test-Path $target) {
    throw "$target already exists and is not a git clone. Remove it first."
} else {
    New-Item -ItemType Directory -Force -Path $plugins | Out-Null
    Write-Host "Cloning into $target"
    git clone --depth 1 $repo $target
}

$bundle = Join-Path $target "dist\gui-experimental.cjs"
$helper = Join-Path $target "scripts\askpass.exe"
Write-Host ""
Write-Host "Installed: $target"
Write-Host "  gui bundle : $(if (Test-Path $bundle) { 'ok' } else { 'missing' })"
Write-Host "  askpass    : $(if (Test-Path $helper) { 'ok' } else { 'missing' })"
Write-Host ""
Write-Host "Restart OpenCode to load it."

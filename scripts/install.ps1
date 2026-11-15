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

$helperOk = $false
if (Test-Path $helper) {
    $bytes = [System.IO.File]::ReadAllBytes($helper)
    $helperOk = $bytes.Length -gt 1024 -and $bytes[0] -eq 0x4D -and $bytes[1] -eq 0x5A
}

Write-Host ""
Write-Host "Installed: $target"
Write-Host "  gui bundle : $(if (Test-Path $bundle) { 'ok' } else { 'missing' })"
Write-Host "  askpass    : $(if ($helperOk) { 'ok' } else { 'missing or damaged' })"
Write-Host ""
Write-Host "Restart OpenCode to load it."

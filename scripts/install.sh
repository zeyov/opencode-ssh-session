#!/usr/bin/env sh
# Installs the plugin from GitHub into the global OpenCode plugins directory.
#
#   sh scripts/install.sh
#
# The plugins directory is discovered automatically, so nothing else is needed.
set -eu

repo="https://github.com/zeyov/opencode-ssh-session"
plugins="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins"
target="$plugins/opencode-ssh-session"

if [ -d "$target/.git" ]; then
  echo "Updating $target"
  git -C "$target" pull --ff-only
elif [ -e "$target" ]; then
  echo "$target already exists and is not a git clone. Remove it first." >&2
  exit 1
else
  mkdir -p "$plugins"
  echo "Cloning into $target"
  git clone --depth 1 "$repo" "$target"
fi

echo
echo "Installed: $target"
echo "Restart OpenCode to load it."

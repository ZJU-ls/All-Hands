#!/usr/bin/env bash
# Install git hooks for this repo.
# Idempotent: safe to rerun; overwrites existing symlinks but backs up real files.
#
# Current hooks:
#   pre-commit  →  scripts/pre-commit.sh  (runs scripts/check.sh)

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hooks_dir="$root/.git/hooks"

if [ ! -d "$hooks_dir" ]; then
  echo "error: $hooks_dir 不存在;这是 git 仓吗?" >&2
  exit 1
fi

install_hook() {
  local name="$1" src="$2"
  local target="$hooks_dir/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    cp "$target" "$target.bak.$(date +%s)"
    echo "backed up existing $name -> $target.bak.*"
  fi
  ln -sf "$src" "$target"
  echo "installed: .git/hooks/$name -> $src"
}

install_hook pre-commit "$root/scripts/pre-commit.sh"

echo ""
echo "Done. 绕过钩子(仅特殊情况):git commit --no-verify"

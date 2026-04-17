#!/usr/bin/env bash
# Start backend + web locally in watch mode. Ctrl-C stops both.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  if [ -n "${back_pid:-}" ] && kill -0 "$back_pid" 2>/dev/null; then
    kill "$back_pid" || true
  fi
  if [ -n "${front_pid:-}" ] && kill -0 "$front_pid" 2>/dev/null; then
    kill "$front_pid" || true
  fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf "[dev] starting backend on :8000\n"
( cd "$root/backend" && uv run alembic upgrade head && uv run uvicorn allhands.main:app --reload --port 8000 ) &
back_pid=$!

printf "[dev] starting web on :3000\n"
( cd "$root/web" && npm run dev ) &
front_pid=$!

wait -n "$back_pid" "$front_pid"

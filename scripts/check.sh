#!/usr/bin/env bash
# Full static-check + test run. CI and pre-commit both call this.
# Any failure exits non-zero; each section is announced for readable CI logs.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

section() {
  printf "\n\033[1;34m==> %s\033[0m\n" "$*"
}

section "backend: ruff (lint)"
( cd "$root/backend" && uv run ruff check . )

section "backend: ruff (format check)"
( cd "$root/backend" && uv run ruff format --check . )

section "backend: mypy (strict)"
( cd "$root/backend" && uv run mypy src )

section "backend: import-linter (layered contracts)"
( cd "$root/backend" && uv run lint-imports )

section "backend: pytest"
( cd "$root/backend" && uv run pytest )

if [ -d "$root/web/node_modules" ]; then
  section "web: lint"
  ( cd "$root/web" && npm run lint )

  section "web: typecheck"
  ( cd "$root/web" && npm run typecheck )

  section "web: test"
  ( cd "$root/web" && npm test )
else
  printf "\n\033[1;33m[skip] web checks — run 'cd web && npm install' first.\033[0m\n"
fi

"$root/scripts/self-review.sh"
"$root/scripts/walkthrough-acceptance.sh"

printf "\n\033[1;32mAll checks passed.\033[0m\n"

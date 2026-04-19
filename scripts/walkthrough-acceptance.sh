#!/usr/bin/env bash
# Walkthrough-acceptance gate · static v0 skeleton.
#
# Implements the automated portion of
# docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md:
#
#   - Prints the W1-W7 matrix (id / goal / v0_active / N1-N6 focus) so a
#     reader sees what will ship and what is on the bench.
#   - Runs the backend acceptance suite (plan shape + v0-active sign-of-life).
#   - Runs the web acceptance suite (plan shape mirror + entry-route
#     realization).
#   - v0: only W1-W3 are actively asserted. W4-W7 are xfail-gated on their
#     preconditions.
#
# The full "real browser" W1-W7 run lives in the Meta Tool
# ``cockpit.run_walkthrough_acceptance`` (spec §3.3) and is triggered manually.
# This script is the gate that runs on every commit.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
plan="$root/backend/tests/acceptance/walkthrough_plan.json"

BLUE=$'\033[1;34m'
GREEN=$'\033[1;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[1;31m'
DIM=$'\033[2m'
RESET=$'\033[0m'

section() { printf "\n%s==> %s%s\n" "$BLUE" "$*" "$RESET"; }

if [ ! -f "$plan" ]; then
  printf "%swalkthrough-acceptance: plan missing at %s%s\n" "$RED" "$plan" "$RESET" >&2
  exit 1
fi

section "W1-W7 acceptance matrix"
python3 - "$plan" <<'PY'
import json
import sys

plan = json.loads(open(sys.argv[1], encoding="utf-8").read())

header = f"{'ID':<4} {'v0':<4} {'Focus':<18} {'Name':<48} {'Precondition':<40}"
print(header)
print("-" * len(header))
for s in plan["stages"]:
    focus = ",".join(s["north_star_focus"])
    tag = "RUN" if s["v0_active"] else "—"
    print(f"{s['id']:<4} {tag:<4} {focus:<18} {s['name'][:46]:<48} {s['preconditions'][:38]:<40}")
PY

section "backend: pytest (tests/acceptance)"
( cd "$root/backend" && uv run pytest tests/acceptance -q --no-header )

if [ -d "$root/web/node_modules" ]; then
  section "web: vitest (tests/acceptance)"
  ( cd "$root/web" && npx vitest run tests/acceptance --reporter=default )
else
  printf "\n%s[skip] web acceptance — run 'cd web && npm install' first.%s\n" "$YELLOW" "$RESET"
fi

printf "\n%swalkthrough-acceptance v0 passed%s · for live W1-W7 run invoke the Meta Tool (spec §3.3).\n" "$GREEN" "$RESET"

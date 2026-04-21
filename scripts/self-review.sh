#!/usr/bin/env bash
# Self-review gate · automated first-line checks.
#
# Implements the "always-on" portion of docs/specs/agent-design/2026-04-18-self-review.md:
# - Visual-discipline scan   · CLAUDE.md §3.5 grep rules (icon libs / raw tailwind colors / dark: / hover shadow / animation libs)
# - Tool-First symmetry      · delegate to backend test TestL01ToolFirstBoundary
# - Bug-triage signoff       · docs/issues/INDEX.md distribution matches filesystem, no unresolved P0
# - Plan loop closure        · if plans/ exists every .md has a Status or Decision-log line
#
# The 3-round multimodal self-review (playwright screenshots + Linear-Precise grading) is NOT here;
# it belongs in a Meta Tool invoked on demand (see spec §7.2). This script is the gate that
# every commit passes through. Exit non-zero on any failure; each section announces itself.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BOLD=$'\033[1m'
BLUE=$'\033[1;34m'
GREEN=$'\033[1;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[1;31m'
RESET=$'\033[0m'

section() { printf "\n%s==> %s%s\n" "$BLUE" "$*" "$RESET"; }
pass()    { printf "%s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()    { printf "%s!%s %s\n" "$YELLOW" "$RESET" "$*"; }
fail()    { printf "%s✗%s %s\n" "$RED" "$RESET" "$*"; FAIL=1; }

FAIL=0
ONLY="${1:-all}"

run_section() {
  local name="$1"
  [ "$ONLY" = "all" ] || [ "$ONLY" = "$name" ]
}

# ------------------------------------------------------------------------------
# 1. Visual discipline · CLAUDE.md §3.5 three rules
# ------------------------------------------------------------------------------
if run_section "visual"; then
  section "visual discipline (CLAUDE.md §3.5)"

  # Only scan web/ source; exclude tests, configs, and the existing design-contract
  # test file that deliberately contains these strings as fixtures.
  web_src() {
    find "$root/web/app" "$root/web/components" "$root/web/lib" \
      -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' \) \
      -not -path '*/node_modules/*' -not -path '*/.next/*' 2>/dev/null
  }

  # §3.5.1 no icon libraries
  icon_hits=$(web_src | xargs grep -l -E "from ['\"](lucide-react|@heroicons|phosphor-react|@phosphor-icons|@tabler/icons)" 2>/dev/null || true)
  if [ -n "$icon_hits" ]; then
    fail "icon-library import detected (§3.5.1 forbidden):"
    printf "  %s\n" $icon_hits
  else
    pass "no icon-library imports"
  fi

  # §3.5.2 no raw tailwind color classes (bg-<color>-<num>, text-<color>-<num>, border-<color>-<num>)
  color_hits=$(web_src | xargs grep -n -E "\b(bg|text|border|ring|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b" 2>/dev/null || true)
  if [ -n "$color_hits" ]; then
    fail "raw tailwind color class detected (§3.5.2 forbidden · use tokens):"
    printf "  %s\n" "$color_hits" | head -20
  else
    pass "no raw tailwind color classes"
  fi

  # §3.5.2 no parallel dark: classes (we use CSS tokens instead)
  dark_hits=$(web_src | xargs grep -n -E "\bdark:(bg|text|border|ring)-" 2>/dev/null || true)
  if [ -n "$dark_hits" ]; then
    fail "dark: prefix detected (§3.5.2 forbidden · tokens auto-adapt):"
    printf "  %s\n" "$dark_hits" | head -20
  else
    pass "no parallel dark: classes"
  fi

  # §3.5.3 no hover-scale or hover-shadow
  motion_hits=$(web_src | xargs grep -n -E "\bhover:(scale|shadow)-" 2>/dev/null || true)
  if [ -n "$motion_hits" ]; then
    fail "hover:scale / hover:shadow detected (§3.5.3 forbidden · use border brightness):"
    printf "  %s\n" "$motion_hits" | head -20
  else
    pass "no hover:scale / hover:shadow"
  fi

  # §3.5.3 no animation libraries
  anim_hits=$(web_src | xargs grep -l -E "from ['\"](framer-motion|gsap|@react-spring/web|lottie-react)" 2>/dev/null || true)
  if [ -n "$anim_hits" ]; then
    fail "animation library import detected (§3.5.3 forbidden):"
    printf "  %s\n" $anim_hits
  else
    pass "no animation libraries"
  fi
fi

# ------------------------------------------------------------------------------
# 2. Tool-First symmetry · delegate to the authoritative backend test
# ------------------------------------------------------------------------------
if run_section "tool-first"; then
  section "tool-first symmetry (CLAUDE.md §3.1 · L01)"

  if [ -d "$root/backend" ]; then
    if ( cd "$root/backend" && uv run pytest tests/unit/test_learnings.py::TestL01ToolFirstBoundary -q --no-header 2>&1 ) | tail -3; then
      pass "TestL01ToolFirstBoundary green"
    else
      fail "TestL01ToolFirstBoundary red · Agent-managed router lacks a paired Meta Tool"
    fi
  else
    warn "backend/ not found · skipping"
  fi
fi

# ------------------------------------------------------------------------------
# 3. Bug-triage signoff · docs/issues/INDEX.md distribution vs filesystem
# ------------------------------------------------------------------------------
if run_section "triage"; then
  section "bug triage signoff (docs/issues/INDEX.md)"

  issues_dir="$root/docs/issues"
  if [ ! -d "$issues_dir" ]; then
    warn "docs/issues/ missing · skipping"
  elif [ ! -d "$issues_dir/open" ]; then
    # After 2026-04-20 triage sweep the open/ directory was removed because
    # it was empty; without this branch `find open/ …` errors under
    # `set -euo pipefail` and silently kills the whole gate.
    pass "INDEX P0 = 0 (open/ directory absent — treated as empty)"
  else
    open_files=$(find "$issues_dir/open" -maxdepth 1 -type f -name 'I-*.md' 2>/dev/null | wc -l | tr -d ' ')

    # Count severities from YAML frontmatter
    count_sev() {
      local sev="$1"
      find "$issues_dir/open" -maxdepth 1 -type f -name 'I-*.md' -print0 2>/dev/null \
        | xargs -0 -I{} awk -v s="$sev" '
            /^---$/ { blocks++; next }
            blocks==1 && /^severity:/ { gsub(/^severity:[[:space:]]*/, ""); print }
          ' {} \
        | grep -c -E "^${sev}\b" || true
    }
    p0=$(count_sev P0)
    p1=$(count_sev P1)
    p2=$(count_sev P2)

    index="$issues_dir/INDEX.md"
    if [ ! -f "$index" ]; then
      fail "INDEX.md missing"
    else
      # Extract the distribution numbers claimed in INDEX.md
      idx_p0=$(awk '/^\| P0 \|/{print $4}' "$index")
      idx_p1=$(awk '/^\| P1 \|/{print $4}' "$index")
      idx_p2=$(awk '/^\| P2 \|/{print $4}' "$index")
      idx_open=$(awk '/^\| \*\*open\*\* \|/{print $4}' "$index")

      check_row() {
        local label="$1" actual="$2" claimed="$3"
        if [ "$actual" = "$claimed" ]; then
          pass "INDEX $label = $actual"
        else
          fail "INDEX $label = $claimed but filesystem shows $actual · run bug-fix-protocol sync"
        fi
      }
      check_row "P0" "$p0" "$idx_p0"
      check_row "P1" "$p1" "$idx_p1"
      check_row "P2" "$p2" "$idx_p2"
      check_row "open" "$open_files" "$idx_open"

      # Soft gate: P0 open issues are a warning — the "must-fix-P0-first" rule
      # in INDEX.md usage rule (1) is enforced per-reviewer for feature commits,
      # not mechanically. track-2-qa's triage commits must be allowed to land
      # the P0 filings themselves, so a hard-fail here would deadlock.
      if [ "$p0" -gt 0 ]; then
        warn "P0 issue count = $p0 · feature commits must clear P0 first (INDEX §usage 1)"
      fi
    fi
  fi
fi

# ------------------------------------------------------------------------------
# 4. Plan loop closure · every plan has explicit Status or Decision-log
# ------------------------------------------------------------------------------
if run_section "plan-loop"; then
  section "plan loop closure (plans/*.md)"

  if [ ! -d "$root/plans" ]; then
    pass "no plans/ directory · nothing to close"
  else
    miss=0
    while IFS= read -r -d '' f; do
      if ! grep -qE "^(##?[[:space:]]+)?(Status|状态|Decision-log|决策日志)\b" "$f"; then
        fail "$(basename "$f") · missing Status / Decision-log section"
        miss=$((miss + 1))
      fi
    done < <(find "$root/plans" -maxdepth 2 -type f -name '*.md' -print0 2>/dev/null)
    if [ "$miss" -eq 0 ]; then
      pass "all plans carry a Status or Decision-log line"
    fi
  fi
fi

# ------------------------------------------------------------------------------
# Exit
# ------------------------------------------------------------------------------
echo
if [ "$FAIL" -ne 0 ]; then
  printf "%sself-review FAILED%s · fix the violations above before committing.\n" "$RED" "$RESET"
  exit 1
fi
printf "%sself-review passed%s.\n" "$GREEN" "$RESET"

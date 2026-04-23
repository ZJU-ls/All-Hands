#!/usr/bin/env bash
# Round 1 · Visual discipline rule engine (self-review spec § 3.3).
#
# Grep-based hard checks for the three highest-priority CLAUDE.md § 3.8 violations:
#   1. Icon libraries (lucide / heroicons / phosphor / tabler)
#   2. Tailwind raw colour classes (bg-blue-500 / text-zinc-400 etc.)
#   3. Motion-heavy interactions (framer-motion / gsap / hover:scale / hover:shadow)
#
# Also catches `dark:` parallel definitions (§ 3.8.2 forbids — use CSS vars instead).
#
# Exit 0 = clean · exit 1 = at least one violation. Intended to be optional part of
# ./scripts/check.sh via `CHECK_REVIEW=1 ./scripts/check.sh`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="${REPO_ROOT}/web"
FAIL=0

# Prefer ripgrep but fall back to `grep -rE` so this runs on fresh macOS
# installs without rg. Excluded paths mirror .gitignore defaults.
if command -v rg >/dev/null 2>&1; then
    GREP_MODE=rg
else
    GREP_MODE=grep
fi

section() {
    printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

# design-lab is the intentional visual showcase — it uses raw hex to demonstrate
# the token palette. Everything else in web/ is production and must follow discipline.
EXCLUDE_DIRS=(node_modules .next .turbo design-lab)

# check label pattern glob_ext  (glob_ext is a comma-separated list of extensions
# without leading dot, e.g. "ts,tsx,js,jsx")
check() {
    local label="$1" pattern="$2" glob_ext="$3"
    local matches=""
    if [[ "$GREP_MODE" == "rg" ]]; then
        local rg_args=()
        local IFS=','
        for ext in $glob_ext; do
            rg_args+=(--glob "*.${ext}")
        done
        unset IFS
        for d in "${EXCLUDE_DIRS[@]}"; do
            rg_args+=(--glob "!**/${d}/**")
        done
        matches="$(rg -n --color=never "${rg_args[@]}" -- "$pattern" "$WEB" 2>/dev/null || true)"
    else
        local include_args=()
        local IFS=','
        for ext in $glob_ext; do
            include_args+=(--include="*.${ext}")
        done
        unset IFS
        local exclude_args=()
        for d in "${EXCLUDE_DIRS[@]}"; do
            exclude_args+=(--exclude-dir="$d")
        done
        matches="$(grep -rnE --color=never \
            "${exclude_args[@]}" \
            "${include_args[@]}" -- "$pattern" "$WEB" 2>/dev/null || true)"
    fi
    if [[ -n "$matches" ]]; then
        printf '\033[31m[FAIL]\033[0m %s\n' "$label"
        printf '%s\n' "$matches" | sed 's/^/    /'
        FAIL=1
    else
        printf '\033[32m[ok]\033[0m %s\n' "$label"
    fi
}

section "1 · icon libraries (CLAUDE.md § 3.8.1 · zero tolerance)"
check "lucide-react" "from ['\"]lucide" "ts,tsx,js,jsx"
check "heroicons" "from ['\"]@heroicons" "ts,tsx,js,jsx"
check "phosphor" "from ['\"]@phosphor" "ts,tsx,js,jsx"
check "tabler icons" "from ['\"]@tabler/icons" "ts,tsx,js,jsx"

section "2 · raw tailwind colour classes (§ 3.8.2 · use token only)"
check "bg-\${color}-{50..900}" "bg-(slate|zinc|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]" "tsx,jsx"
check "text-\${color}-{50..900}" "text-(slate|zinc|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]" "tsx,jsx"
check "border-\${color}-{50..900}" "border-(slate|zinc|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]" "tsx,jsx"
check "hex color in JSX (#rrggbb)" "['\"]#[0-9A-Fa-f]{6}" "tsx"

section "3 · parallel dark: definitions (§ 3.8.2 · use CSS vars)"
check "dark: class utilities" "\\bdark:(bg|text|border)-" "tsx,jsx"

section "4 · motion-heavy libs (§ 3.8.3 · banned)"
check "framer-motion" "from ['\"]framer-motion" "ts,tsx,js,jsx"
check "gsap" "from ['\"]gsap" "ts,tsx,js,jsx"

section "5 · interaction feedback violations (§ 3.8.3 · banned for hover/active)"
check "hover:scale-*" "hover:scale-[0-9]" "tsx,jsx"
check "active:scale-*" "active:scale-[0-9]" "tsx,jsx"
check "hover:shadow-*" "hover:shadow-(sm|md|lg|xl|2xl)" "tsx,jsx"

section "6 · impeccable BAN 2 (ADR 0013 · no gradient text)"
# Flag any `background-clip: text` pattern — the JSX/CSS idiom that fills
# text with a linear/radial/conic gradient. Solid-color text only; hierarchy
# comes from weight/size, not a fill gradient. Explicit in product/03-visual-design.md §0.4.
check "background-clip: text" "(background-clip|-webkit-background-clip):\s*text" "tsx,jsx,css"
check "bg-clip-text (JSX)" "bg-clip-text" "tsx,jsx"

printf '\n'
if [[ $FAIL -eq 0 ]]; then
    printf '\033[1;32mAll review lint rules passed.\033[0m\n'
    exit 0
else
    printf '\033[1;31mLint violations detected — fix before shipping.\033[0m\n'
    printf 'See CLAUDE.md § 3.8 for the three highest rules (no icon libs · ≤3 colour density · motion ≤ 2px).\n'
    exit 1
fi

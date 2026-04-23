# ADR 0013 · Typography Refresh + Impeccable Reconciliation

- **Status**: Accepted (2026-04-22)
- **Amends**: [ADR 0007 · Visual Tokens](0007-visual-tokens.md), [ADR 0011 · Principles Refresh](0011-principles-refresh.md), [ADR 0012 · Viz Palette](0012-viz-palette-extension.md)
- **Triggered by**: 2026-04-22 session — user installed the [impeccable](https://impeccable.style/) design skill pack and flagged two complaints: "字太小" (text too small) and "不够酷炫" (not cool enough). Impeccable's typography + design principles land some legitimate hits on the current Linear Precise rules; this ADR reconciles.

## Context

[Linear Precise](0007-visual-tokens.md) produced a calm, Linear-like app. The tradeoffs that made it calm — 13px body, all-zinc neutrals, 2px primary left-bar as a signature motif — also made it *small and austere*. When a user loads the chat surface, the base text reads below the 16px threshold most typography references recommend for body, and the design motifs (stripe-on-card, plain hairline borders) overlap with the "AI slop" patterns [impeccable.style](https://impeccable.style/) trains against.

Impeccable's install (skills copied to `~/.claude/skills/impeccable/`) gave us a clear set of principles to reconcile against:

1. **Body text ≥ 16px, 5-step modular scale ≥ 1.25 ratio**.
2. **Tint neutrals toward brand hue** (even ~0.01 OKLCH chroma).
3. **Absolute ban on side-stripe borders > 1px** as accent on cards / list items / callouts / alerts.
4. **Absolute ban on gradient text** (`background-clip: text` + gradient).
5. **No pure `#000` / `#fff`** for theme foundations.
6. **Avoid uniform padding**; use varied spacing for hierarchy.

We have to decide which of these we adopt, which we reject, and which we adapt for the "dense app UI" context.

## Decision

### Adopted

**A. Type scale bump.** Body text rises from 13px → 15px. We don't go to impeccable's 16px floor because the allhands surfaces are dense app UI (nested panels, sidebars, tool-call cards, trace drawers), and 16px at 80% bubble width wraps too aggressively. 15px is the pragmatic midpoint: readable, respects rem sizing (so user zoom still scales), and keeps one-line density in tool chips. Documented as the project's specific body floor in `03-visual-design.md §1.3`.

**B. 5-size modular scale with 1.25 ratio.** Replace the 6-size ad-hoc scale with:

| Token | Size | Role |
|---|---|---|
| `--text-caption` | 0.75rem (12px) | Mono meta, keyboard chips, trace ids |
| `--text-sm` | 0.8125rem (13px) | Secondary UI, labels inside cards |
| `--text-base` | 0.9375rem (15px) | Body, chat content, input |
| `--text-lg` | 1.1875rem (19px) | Card titles, drawer headers, subheadings |
| `--text-xl` | 1.5rem (24px) | Page titles, hero metrics |
| `--text-display` | 2rem (32px) | Empty-state hero, landing |

Ratio 1.25 ("major third"). `rem`-based so zoom respects user preference.

**C. Tinted neutrals.** The zinc ramp gets pulled ~0.005 chroma toward the indigo primary hue via OKLCH. The tint is barely perceptible on its own but creates subconscious cohesion with `--color-primary` across the app. Hex values are hand-calibrated to match and retained as the canonical token value (OKLCH support is good in all modern browsers but we keep hex for trivial serialization and test diffing).

**D. Impeccable BAN 1 on side-stripe borders is adopted — with one explicit carve-out.** The `border-left: 2px ...` pattern I had just added to Callout, KV section titles, and PlanCard pending state is replaced with: (Callout) tinted background + leading glyph circle; (KV title) uppercase letter-spacing + underline; (PlanCard pending) full-card tinted bg. **One exception is kept**: the active-navigation marker on the sidebar (`激活色条`). That bar is *state*, not *decoration* — it marks exactly one element at a time, and removing it leaves no affordance for the currently-selected nav item. This is the Linear/Raycast convention and the same pattern impeccable itself uses for the selected item in its cheatsheet. Documented as the sole exception in spec §3.8.

**E. Impeccable BAN 2 on gradient text is adopted as-is.** We don't have any `background-clip: text` + gradient anywhere; added to the lint rules so we can't add it by mistake.

**F. More motion easing options.** `--ease-out-quart` (`cubic-bezier(0.25, 1, 0.5, 1)`) and `--ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`) added alongside the existing standard ease-out. The current `--ease-out: cubic-bezier(0.4, 0, 0.2, 1)` stays as the default for UI-chrome transitions; the longer-tailed curves are for hero-level reveals and Viz entry animations.

### Rejected

**G. Fluid typography with `clamp()` on app UI.** Impeccable explicitly reserves fluid type for marketing/content and recommends fixed `rem` for app dashboards — which matches our tradition. No change.

**H. Full OKLCH migration.** The rationale for OKLCH is stronger in marketing / brand palettes where perceptual uniformity of lightness is visible. For the allhands app, the existing hex palette is hand-tuned and tested across light + dark; a wholesale migration would regress a lot of carefully-calibrated borders for a benefit the user won't see. We tint the neutrals toward the brand hue as a surgical win and leave the rest alone.

**I. "16px body minimum, full stop."** 15px, reasoned above.

### Modified

**J. "Colour density ≤ 3" rule restated.** The rule was already carved out for BrandMark (ADR 0007), Viz palette (ADR 0012), and semantic status colors. Rather than adding yet another carve-out, the spec §0.2 is rewritten as: **"UI chrome (nav / buttons / chips / layout) uses at most 3 non-semantic tokens (text / muted / primary). Data viz, brand identity, and callout kinds get their own palettes via ADR 0012 / 0007 / semantic-status tokens. Everything else — don't invent new hues."** Simpler to enforce, same outcome.

## Consequences

### Code

- `web/app/globals.css`: new type scale tokens, tinted neutrals, 2 additional ease curves.
- `web/tailwind.config.ts`: map the 5 type scale tokens to Tailwind utilities (`text-caption` … `text-display`), expose new easings (`ease-out-quart`, `ease-out-expo`).
- `web/app/globals.css § .ah-prose`: body 0.9rem → 0.95rem (15px) + line-height 1.55 → 1.6.
- `web/components/chat/MessageBubble.tsx`: bubble body `text-sm` → `text-[15px]`.
- `web/components/render/Viz/Callout.tsx`: drop left bar, keep bg tint + glyph circle.
- `web/components/render/Viz/KV.tsx`: replace left bar with underline + uppercase section title.
- `web/components/render/PlanCard.tsx`: pending state uses full-card tinted bg, not left bar.
- Keep sidebar active-nav left bar (sole BAN 1 exception, documented in spec).

### Lint & review

- `scripts/review/lint-rules.sh`: add a check for `background-clip:\s*text;?\s*background:\s*(linear|radial|conic)-gradient` to enforce BAN 2 going forward.

### Docs

- `product/03-visual-design.md` §0.2, §1.1, §1.3, §3.8 rewritten for the new type scale + ban language.
- This ADR.

### Migration

None. All changes are refactors of existing rules + visual refinements. No data migration, no API change.

## References

- [impeccable.style](https://impeccable.style/) — source of the principles being reconciled
- Local install: `~/.claude/skills/impeccable/` (18 skills including `typeset`, `polish`, `overdrive`, `layout`)
- User feedback: 2026-04-22 "字太小" + "不够酷炫"
- [ADR 0007 · Visual Tokens](0007-visual-tokens.md) — original Linear Precise palette
- [ADR 0012 · Viz Palette](0012-viz-palette-extension.md) — data-viz color carve-out

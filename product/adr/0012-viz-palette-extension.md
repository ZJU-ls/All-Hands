# ADR 0012 · Data Visualization Palette Extension

- **Status**: Accepted (2026-04-22)
- **Supersedes**: partially refines the "颜色密度 ≤ 3" rule in [ADR 0007](0007-visual-tokens.md) and [03-visual-design.md §0.2](../03-visual-design.md).

## Context

Linear Precise (see [ADR 0007](0007-visual-tokens.md)) caps the visual palette at ≤ 3 non-semantic colors (`text / muted / primary`) for UI chrome. The rule came out of "Dify rainbow UI" fatigue and holds for navs, buttons, chips, cards, and layout scaffolding.

It fails for data visualization.

When the Lead Agent calls `render_line_chart` with four time series, or `render_pie_chart` with six slices, the old rule forced every series to be the same hue (primary) distinguished only by opacity steps. This is the "太素" feedback from 2026-04-22 — multi-series charts read as grey soup, slices blur together, and the user can't match a legend entry to a shape. The constraint that produces a calm homepage produces an illegible dashboard.

Two rejected alternatives:

1. **Keep the rule; use shape / texture / pattern.** Dashed vs solid lines, cross-hatched vs filled bars. Fails because: (a) grayscale shape differentiation is noisier than hue; (b) patterns don't survive the 100-pixel sparkline case; (c) the industry convention for "what is each series?" is color, and violating it costs more cognition than it saves.
2. **Expand the global palette to 6 hues and allow them everywhere.** Fails because: (a) it invites ad-hoc hue usage on non-viz surfaces (status chips, buttons), rebuilding the rainbow fatigue we escaped; (b) there is no principled line for "when may I use hue?" if the rule is simply relaxed.

## Decision

Introduce a **data-viz palette** of six tokenized hues, namespaced `--color-viz-1` through `--color-viz-6`, scoped **exclusively** to data-visualization contexts:

- `web/components/render/Viz/**` — every chart / metric / distribution component
- Inline sparklines and sequence indicators that distinguish ≥ 2 categorical data points
- Explicitly **not** allowed in `components/ui/**`, navs, buttons, or layout chrome

The six hues, ordered by series cycle (indigo → teal → amber → rose → violet → sky), are specified in `globals.css` with light + dark variants and mapped through `tailwind.config.ts` as `viz-1`…`viz-6`. Companion tokens `--color-{primary,success,warning,danger}-soft` and `--color-surface-hover` bake alpha into the token so call sites don't compose opacity strings.

The color-density ≤ 3 rule stands for everything outside this narrow scope. It is not weakened; its **boundary is sharpened**.

## Rationale

**Why six, not four or eight.** Four is too few for the common "platform composition by provider" / "spend by employee" cases in cockpit. Eight starts pushing adjacent hues into perceptual merger territory on sparklines. Six gives a clear categorical ceiling matching the `pie_chart` and `bar_chart` schema limits already in place — the palette enforces the schema cap visually.

**Why tokenize rather than let charts pick colors dynamically.** Stable tokens mean:
- Chart 1's "series 2 = teal" stays consistent across conversations
- Theme switching (light/dark) updates via CSS vars, not JS recomputation
- The lint rule (`scripts/review/lint-rules.sh`) can enforce "no raw hex in charts" by looking for `var(--color-viz-N)` usage

**Why scope to `components/render/Viz/**` only.** This is the load-bearing constraint. Every color-palette extension in a design system starts as "just for charts" and ends up as accent fills on headers three months later. The lint rule must be updated to flag `viz-N` usage outside the allowed directories (follow-up; see Consequences).

**Why companion `-soft` tokens.** Color-density rule historically forced `bg-primary/10` at every tinted-background site. Aliasing that as `bg-primary-soft` improves readability, makes theme switching atomic, and keeps the token usage grep-able for audits. This is a style improvement orthogonal to the palette extension but lands in the same commit because the design-lab showcases them together.

## Consequences

### Contract updates

- [`product/03-visual-design.md §0.2`](../03-visual-design.md) gains an explicit carve-out pointing to this ADR. The rule becomes "colour density ≤ 3 on UI chrome; data-viz palette allowed in render/Viz/** per ADR 0012."
- [`design-system/MASTER.md`](../../design-system/MASTER.md) documents the palette in the tokens section with a usage matrix.

### Code updates

- `web/app/globals.css`: add `--color-viz-1..6` and `--color-{*}-soft` tokens, light + dark.
- `web/tailwind.config.ts`: expose `viz-1..6`, `*-soft`, `surface-hover` utilities.
- `web/components/render/Viz/**`: LineChart uses palette per series; PieChart per slice; BarChart cycles palette by index; Stat uses `*-soft` for delta pills; Callout uses `*-soft` for tinted backgrounds; Table uses `surface-hover` for row hover; Cards gains optional accent gradient hairline.

### Lint & review

- `scripts/review/lint-rules.sh` is **not** modified in this commit. A follow-up should add: "viz-N tokens used outside `web/components/render/Viz/**` → FAIL". Captured in this ADR as owed work.
- Existing "no raw tailwind colors" check continues to pass — all new tokens go through the CSS-var → tailwind-key pipeline.

### Migration

None. Existing Viz components that used `currentColor` + opacity steps are rewritten in the same commit. No downstream consumer to notify — render payloads are produced by backend tools and consumed by the internal registry.

### Observability

The visible win is easily verifiable: render `pie_chart` with 6 slices, confirm 6 distinct perceptual hues instead of 6 opacity steps of one hue. `/design-lab` is updated to include a multi-series LineChart and a 6-slice PieChart as regression samples for the `render-library-coverage` test.

## References

- [ADR 0007 · Visual Tokens](0007-visual-tokens.md) — the original Linear Precise palette this ADR refines.
- [`product/03-visual-design.md §11`](../03-visual-design.md) — composition primitives (sparkline, dotgrid, hairline accent) that predate this ADR and remain in effect.
- 2026-04-22 session: user feedback "现在这些渲染组件我感觉还是太素了" on the 11-viz demo turn.

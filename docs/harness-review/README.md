# Harness Review · Cool-down Mirror

This directory holds harness-review artefacts per
[`docs/specs/agent-design/2026-04-18-harness-review.md`](../specs/agent-design/2026-04-18-harness-review.md).

Harness review is the **tool-chain audit** that runs *after* self-review + walkthrough-acceptance.
It asks: "is `docs/claude/*.md` still in sync with the code?" and, after a 7-day cooling period,
"if I walked in fresh, would I still like this product?".

## Layout

```
docs/harness-review/
├── README.md                          (this file)
├── TEMPLATE-step-1-docs.md            docs drift audit template
├── TEMPLATE-step-3-fresh-eyes.md      cool-down product re-look template
├── TEMPLATE-summary.md                aggregate template
├── history.md                         one-line ledger per review
└── YYYY-MM-DD/
    ├── step-1-docs.md                 produced by scripts/harness/audit-docs.sh
    ├── step-2-diff.md                 what actually got edited (→ commits)
    ├── step-3-fresh-eyes.md           after ≥ 7d cool-down — fresh-user persona
    └── summary.md
```

## How to run a harness review

1. Confirm the preceding self-review has a `summary.md` committed.
2. Generate Step 1 draft · `./scripts/harness/audit-docs.sh`
   - Writes `YYYY-MM-DD/step-1-docs.md` listing suspect L{nn}, missing regression test files,
     ref-src-claude path drift, harness-playbook backport candidates.
   - Advisory only — executing Claude reviews manually and decides real vs false positive.
3. Step 2 — edit the flagged docs, commit as `chore(harness-review): docs drift cleanup`.
4. **Cool-down.** Wait ≥ 7 days. Do not open the product in between.
5. Step 3 — walk the product again as a "first-time user who forgot everything". Write
   `YYYY-MM-DD/step-3-fresh-eyes.md`: 3 things to change, 1 thing to keep, 1 thing
   Rounds 1-3 missed.
6. Write `YYYY-MM-DD/summary.md`, append a one-liner to `history.md`.

## Meta Tool

[`allhands.meta.cockpit.run_harness_review`](../../backend/src/allhands/execution/tools/meta/review_tools.py)
— Lead can kick this off via chat. WRITE + `requires_confirmation=True` because it takes
30min–2h wall clock and writes to `docs/`. Default `cool_down_days=7`; `steps=[1,2,3]`.

## Cross-reference

- [`2026-04-18-self-review.md`](../specs/agent-design/2026-04-18-self-review.md) — prior gate
- [`2026-04-18-walkthrough-acceptance.md`](../specs/agent-design/2026-04-18-walkthrough-acceptance.md) — sibling gate
- [`docs/claude/working-protocol.md § 阶段 6`](../claude/working-protocol.md) — autopilot cadence
- [`docs/meta/harness-playbook.md`](../meta/harness-playbook.md) — backport target for generic learnings

## Principle · why this exists

Docs lag code. `docs/claude/*.md` is read at session start — if stale, every future session starts
from a wrong mental model. Harness review is the **drift-delta generator**. Evidence is the product,
not opinion: every flagged entry must cite grep output, commit sha, or file path.

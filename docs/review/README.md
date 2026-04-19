# Self-Review · Round Outputs

This directory holds the 3-round self-review outputs mandated by
[`docs/specs/agent-design/2026-04-18-self-review.md`](../specs/agent-design/2026-04-18-self-review.md).

## Layout

```
docs/review/
├── README.md                              (this file)
├── TEMPLATE-round-N.md                    round 1/2/3 findings template
├── TEMPLATE-summary.md                    summary template
└── YYYY-MM-DD-round-{1,2,3}.md            per-round findings
└── YYYY-MM-DD-summary.md                  aggregate summary + delight moments
```

## How to run a self-review

1. Ensure `./scripts/check.sh` is fully green; if not, fix first.
2. Start dev (`cd web && pnpm dev`) — Round 2 / 3 walk a live browser.
3. Invoke meta tool `cockpit.run_self_review` (via Lead chat or `/review` page)
   OR walk manually:
   - Round 1 · run `./scripts/review/lint-rules.sh` for mechanical catches
     + multimodal read of `plans/screenshots/*/full-page/*.png`
   - Round 2 · walk P01-P10 flows per spec § 4
   - Round 3 · walk empty / error / edge-data states per spec § 5
4. Write findings into `YYYY-MM-DD-round-N.md` (copy `TEMPLATE-round-N.md`).
5. Fix P0 within the round; P1 at least ≥ 3 survived; P2 optional.
6. Run `./scripts/check.sh` between rounds; must stay green.
7. After Round 3, write `YYYY-MM-DD-summary.md` with 3 "delight moments"
   preserved from Round 3 (spec § 5.5).

## Three personas — do not merge

| Round | Persona | Core question |
|-------|---------|---------------|
| 1 · visual | Linear-Precise gatekeeper | Does it feel like one system? |
| 2 · usable | new-user PM | Can I do main flows in ≤ 3 clicks? |
| 3 · lovable | jaded power user | Is there a reason to come back? |

Never merge personas into one pass — each sees different things. Spec § 2.1.

## Cross-reference

- [`working-protocol.md § 阶段 4.5`](../claude/working-protocol.md) — when to trigger
- [`docs/walkthrough-acceptance/README.md`](../walkthrough-acceptance/README.md) — the
  gate that follows self-review (N1-N6 north-star verdict)
- [`docs/harness-review/README.md`](../harness-review/README.md) — the cool-down
  mirror that audits doc drift after a review has completed

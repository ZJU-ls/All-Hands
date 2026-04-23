# harness · QA gate bundle

This directory is the unified entry for the Wave-2 QA gates. Three scripts + one
playbook + one acceptance plan:

```
harness/
├── README.md               ← this file
├── qa-playbook.md          ← end-to-end usage guide (who runs what, when)
├── gates.sh                ← runs self-review + walkthrough-acceptance in order
└── ...                     (data / cache only — do not commit)
```

The actual gate scripts live in `../scripts/` so they can also be invoked à la
carte during development:

- `scripts/self-review.sh`         · CLAUDE §3.8 视觉纪律 + Tool-First + bug-triage + plan-loop
- `scripts/walkthrough-acceptance.sh` · W1-W7 matrix + v0 sign-of-life

`scripts/check.sh` sources `harness/gates.sh` at its tail so every commit passes
both gates as well as the core lint/type/test trio.

## When to use this directory

- **Add a new gate** (e.g. `perf-budget.sh`) → create `scripts/<gate>.sh`, add
  a line to `harness/gates.sh`, and document it in `qa-playbook.md`.
- **Snapshot gate output for a release** → redirect `./harness/gates.sh` into a
  file under `plans/release-<date>/harness.log` (release artifacts only).

## Not in this directory

- Live browser walkthroughs — they live in the
  `cockpit.run_walkthrough_acceptance` Meta Tool (spec §3.3), gated by
  `ConfirmationGate` and driven by chrome-devtools MCP.
- Per-session review journals — `docs/review/YYYY-MM-DD-*.md` (gitignored).

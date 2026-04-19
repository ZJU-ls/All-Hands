# QA Playbook · Wave 2

> Intended to live at `docs/claude/qa-playbook.md` per the track-2-qa prompt.
> That path is covered by `.gitignore` (`/docs/claude/`) so the file sits in
> `harness/` instead and stays in the repo. Move-in when / if the gitignore
> exception is added.

This playbook documents how Wave-2's three QA gates fit together, who runs
each, when they run, and how to wire a new spec into the QA system.

---

## 0 · The three gates

| Gate | Script | When | Role |
|---|---|---|---|
| **self-review** | `scripts/self-review.sh` | every commit (via `scripts/check.sh`) | static contracts: visual discipline, Tool-First symmetry, bug-triage signoff, plan-loop closure |
| **walkthrough-acceptance** | `scripts/walkthrough-acceptance.sh` | every commit (via `scripts/check.sh`) | prints the W1-W7 matrix + runs v0-active sign-of-life tests (W1-W3 today) |
| **harness/gates.sh** | `harness/gates.sh` | explicit invocation / CI | orchestrates the two above in order so we can tighten CI without touching `scripts/check.sh` again |

`scripts/check.sh` tails with two lines that invoke the first two gates.
`harness/gates.sh` is kept separate so a human can run the gates by
themselves (`./harness/gates.sh`) without paying for the whole
lint/type/test upstream.

---

## 1 · What the static gates do NOT do

They are cheap and mechanical. They do not replace the Meta-Tool-driven live
reviews.

| Need | Script (static) covers? | Live tool covers? |
|---|---|---|
| grep-level visual-discipline regressions (icons / raw tailwind colors / dark:) | ✅ | — |
| Tool-First symmetry (REST write ↔ Meta Tool) | ✅ | — |
| W1-W7 structural preconditions | ✅ | — |
| visual Linear-Precise score (full page screenshots + CSS sampling) | ❌ | `cockpit.run_self_review` (self-review §7.2) |
| 3-round good-looking / good-to-use / lovable loop | ❌ | `cockpit.run_self_review` |
| live W1-W7 chrome-devtools walkthrough with N1-N6 scoring | ❌ | `cockpit.run_walkthrough_acceptance` (walkthrough §3.3) |
| harness-doc drift audit (`docs/claude/*.md` vs code) | ❌ | `cockpit.run_harness_review` (harness-review §4) |

The static gates catch 80% of the day-to-day violations; the Meta Tools
catch the 20% that need a live browser and human judgment.

---

## 2 · Adding a new spec to the QA system

When you land a new spec under `docs/specs/agent-design/`, do **four** QA
hookups at the same time as the feature commits. Without them, your DoD
statements are aspirational.

### 2.1 Declare your DoD

Every spec must have a `§ DoD` section with **machine-checkable** bullets:

- `- [ ] <meta-tool-name> registered in <path>` → `scripts/self-review.sh`'s
  Tool-First symmetry test will enforce this once the router exists.
- `- [ ] migration NNNN applied` → covered by `alembic upgrade head` in
  `check.sh`.
- `- [ ] <route> renders` → add to `walkthrough_plan.json` if core-user-journey.
- `- [ ] <test-path> passes` → create the file, even if empty; `check.sh`
  collects it.

### 2.2 Plug into `walkthrough_plan.json` (only for user-journey specs)

If your spec adds a new N-star journey (e.g. "user installs a skill from
chat"), extend the W-N matrix in
`backend/tests/acceptance/walkthrough_plan.json`. Shape:

```json
{
  "id": "W8",
  "name": "Install skill (chat only)",
  "goal": "...",
  "entry_route": "/",
  "required_meta_tools": ["install_skill"],
  "required_routers": ["skills.py"],
  "north_star_focus": ["N1","N3"],
  "v0_active": true,
  "preconditions": "..."
}
```

Then add a matching `backend/tests/acceptance/test_w8_<slug>.py` with
sign-of-life assertions. The `test_walkthrough_plan.py` shape tests will
auto-validate the entry.

### 2.3 Add a spec-specific audit regression (if DoD is not machine-checkable)

If a DoD bullet can only be asserted "when actually running", file it as an
xfailing test in `backend/tests/acceptance/test_audit_regressions.py` with
a pointer to the issue ID. When the fix lands, flip xfail → assert and
close the issue.

### 2.4 Update this playbook

If you added a new gate or a new Meta Tool invocation, add a row to the
tables above.

---

## 3 · Commit-time checklist

Every Wave-2 commit (any track) goes through:

1. Staged files match the track's white-list.
2. `./scripts/check.sh` exits 0 (all three sections green, self-review
   warns only on P0 open count which is informational for non-triage
   commits).
3. Commit message prefix matches the track (`[track-2-qa]`, `[track-3-stock]`,
   or plain Conventional Commits for main-track).

---

## 4 · How to close an audit issue

1. Write the fix on a normal branch.
2. Flip the corresponding xfail in `test_audit_regressions.py` to an
   assert (or delete the test if it was structural and the new file now
   covers it).
3. `./scripts/check.sh` green.
4. Append a `## 关闭记录` block to the issue file with sha + regression
   test name.
5. `mv docs/issues/open/I-NNNN-*.md docs/issues/closed/`.
6. Remove the row from `docs/issues/INDEX.md` + update the distribution
   table.
7. `git commit -m "fix(I-NNNN): ... + 回归测试 <name>"`.

`scripts/self-review.sh`'s bug-triage section enforces INDEX/filesystem
consistency; it will fail the next commit if (6) is skipped.

---

## 5 · Known escape hatches

- **self-review P0 count > 0** is a warning, not a failure. Feature-code
  reviewers are expected to reject patches that ignore the P0 list; QA
  track commits (which *file* P0 issues) must be able to land.
- **W-N test xfails** are intentional sign-of-life markers. They auto-flip
  to xpass when the precondition lands; pytest then reports `XPASS` and
  forces you to tighten the assertion — that's the signal to invest.
- **Web acceptance tests skip silently** when `web/node_modules` is
  absent. CI must run `pnpm install` first. Local dev can skip it.

---

## 6 · Where the live review tools live

| Tool | Spec section | Confirmation scope |
|---|---|---|
| `cockpit.run_self_review` | 2026-04-18-self-review.md §7.2 | WRITE + `requires_confirmation=True` |
| `cockpit.run_walkthrough_acceptance` | 2026-04-18-walkthrough-acceptance.md §3.3 | WRITE + `requires_confirmation=True` |
| `cockpit.run_harness_review` | 2026-04-18-harness-review.md §4 | WRITE + `requires_confirmation=True` |

All three are **not yet implemented** as of 2026-04-19 (track-2-qa built the
static scaffolding only). When implementing, re-use the JSON manifest at
`backend/tests/acceptance/walkthrough_plan.json` as the single source of
truth for the W1-W7 matrix.

---

## 7 · History

- 2026-04-19 · first drop (track-2-qa · Wave 2)

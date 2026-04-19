"""Review family meta tools — 3-round self-review, walkthrough acceptance, harness review.

Specs:
- `docs/specs/agent-design/2026-04-18-self-review.md` (3-round polish loop)
- `docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md` (N1-N6 north-star verdict)
- `docs/specs/agent-design/2026-04-18-harness-review.md` (docs drift + cool-down)

These are **orchestration tools**, not agent-managed resource CRUD, so L01 REST-parity
does not apply. They are invoked by Lead Agent (via chat) or by the executing Claude
(via `/review` page) after a batch of feature specs lands.

Contract shape mirrors `task_tools.py` (V04 TodoWrite idiom): each tool has an explicit
"WHEN TO USE" + "WHEN NOT TO USE" block and enumerates params inline. All three are
IRREVERSIBLE from the perspective that they write to `docs/review/` / `plans/` /
`docs/harness-review/` and take 30min-2h of wall clock; confirmation is required so a
stray Lead call does not burn the budget.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

COCKPIT_RUN_SELF_REVIEW_TOOL = Tool(
    id="allhands.meta.cockpit.run_self_review",
    kind=ToolKind.META,
    name="cockpit.run_self_review",
    description=(
        "Kick off the 3-round self-review loop on the currently running instance. "
        "Round 1 = visual (Linear Precise discipline); Round 2 = usable (P01-P10); "
        "Round 3 = lovable (empty/error states, copy voice, micro-delight).\n\n"
        "**WHEN TO USE**: After a major batch of user-visible specs has landed AND "
        "`./scripts/check.sh` is fully green. Produces `docs/review/YYYY-MM-DD-round-"
        "{1,2,3}.md` + `summary.md`. Expect ~1-2h wall clock. Keep at least 3 "
        "'delight moments' in the summary (spec § 12).\n\n"
        "**WHEN NOT TO USE**: Mid-feature (drift obscures signal) · any check.sh "
        "red (fix first) · < 2 weeks since last self-review (cool-down violation).\n\n"
        "**PARAMS**: rounds (optional · default [1,2,3] · can run 1 or 2 if partial), "
        "dry_run (default false · skips actual playwright runs; only scaffolds docs)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "rounds": {
                "type": "array",
                "items": {"type": "integer", "enum": [1, 2, 3]},
                "default": [1, 2, 3],
            },
            "dry_run": {"type": "boolean", "default": False},
        },
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "review_dir": {"type": "string"},
            "rounds_completed": {"type": "array", "items": {"type": "integer"}},
            "findings_counts": {"type": "object"},
            "summary_path": {"type": "string"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


COCKPIT_RUN_WALKTHROUGH_ACCEPTANCE_TOOL = Tool(
    id="allhands.meta.cockpit.run_walkthrough_acceptance",
    kind=ToolKind.META,
    name="cockpit.run_walkthrough_acceptance",
    description=(
        "Simulate a real new user via chrome-devtools MCP · walk W1-W7 main paths · "
        "score N1-N6 north-star dimensions · loop until green (or user-acked or budget "
        "exhausted). This is the last gate before shipping to the user.\n\n"
        "**WHEN TO USE**: After self-review 3 rounds are done AND all 9 feature "
        "specs have shipped. Produces `plans/<plan>.md § 走查验收包 · YYYY-MM-DD` "
        "with per-iteration screenshots, N1-N6 verdicts, debts, and fix-reeval loop.\n\n"
        "**WHEN NOT TO USE**: self-review not done · dev server not running · no "
        "provider/model configured (W1 Bootstrap would hard-fail).\n\n"
        "**PARAMS**: paths (default all W1-W7), fail_fast (default false — loop_until_green "
        "overrides anyway), loop_until_green (default true), max_iterations (default 5), "
        "auto_fix_p0 (default true · P0 allowed to self-fix behind ConfirmationGate), "
        "auto_fix_p1_threshold (default 0.5 · fraction of P1 to fix this iter), "
        "user_ack_remaining (optional · pass verbatim user-signed text to exit early "
        "per spec § 3.7.3 clause 2)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "paths": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
                },
                "default": ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
            },
            "fail_fast": {"type": "boolean", "default": False},
            "loop_until_green": {"type": "boolean", "default": True},
            "max_iterations": {"type": "integer", "minimum": 1, "maximum": 5, "default": 5},
            "auto_fix_p0": {"type": "boolean", "default": True},
            "auto_fix_p1_threshold": {
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
                "default": 0.5,
            },
            "user_ack_remaining": {"type": "string"},
            "screenshot_dir": {"type": "string"},
        },
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "summary_path": {"type": "string"},
            "iterations_run": {"type": "integer"},
            "per_path_verdict": {"type": "object"},
            "blockers": {"type": "array", "items": {"type": "string"}},
            "debts": {"type": "array"},
            "next_action": {"type": "string"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


COCKPIT_RUN_HARNESS_REVIEW_TOOL = Tool(
    id="allhands.meta.cockpit.run_harness_review",
    kind=ToolKind.META,
    name="cockpit.run_harness_review",
    description=(
        "Kick off the 3-step harness review loop on this repository. Step 1 audits "
        "`docs/claude/*.md` + `harness-playbook.md` against current code; Step 2 fixes "
        "drift; Step 3 is a cool-down 'fresh eyes' product walk (same as self-review "
        "Round 2 script but with a new-user persona).\n\n"
        "**WHEN TO USE**: After a major batch of specs has shipped AND self-review is "
        "done AND at least 7 days since last harness-review (cool-down is load-bearing "
        "per spec § 2.3). Produces `docs/harness-review/YYYY-MM-DD/{step-1,step-2,"
        "step-3-fresh-eyes,summary}.md` + PR (low-risk auto-mergeable; follow-up work "
        "goes into `plans/`).\n\n"
        "**WHEN NOT TO USE**: < biweekly cadence (cool-down violation) · mid-feature "
        "(drift hasn't accumulated enough to be worth auditing).\n\n"
        "**PARAMS**: steps (optional · default [1,2,3]), cool_down_days (default 7 · "
        "refuse run if last review was sooner), dry_run (default false)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {"type": "integer", "enum": [1, 2, 3]},
                "default": [1, 2, 3],
            },
            "cool_down_days": {"type": "integer", "minimum": 0, "default": 7},
            "dry_run": {"type": "boolean", "default": False},
        },
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "review_dir": {"type": "string"},
            "drift_count": {"type": "integer"},
            "playbook_backports": {"type": "array", "items": {"type": "string"}},
            "fresh_eyes_followups": {"type": "array", "items": {"type": "string"}},
            "summary_path": {"type": "string"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


ALL_REVIEW_META_TOOLS = [
    COCKPIT_RUN_SELF_REVIEW_TOOL,
    COCKPIT_RUN_WALKTHROUGH_ACCEPTANCE_TOOL,
    COCKPIT_RUN_HARNESS_REVIEW_TOOL,
]

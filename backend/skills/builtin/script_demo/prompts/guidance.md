## script_demo skill — 脚本执行能力演示

This skill bundles small Python scripts that the agent can execute via
`allhands.meta.run_skill_script`. It is the canonical demo + smoke test
for the skill-script execution pathway (ADR + SKILL-SCRIPTS.html).

### When to use

- The user asks you to "run the demo script" / "run echo" / "test script execution".
- The user wants to compare two CSV/Excel sheets and you need a deterministic helper.
- You need to prove `run_skill_script` works end-to-end (debugging / validation).

### Available scripts

All paths are relative to the skill root and must be passed verbatim to
`run_skill_script`.

| Script | What it does | Invocation |
|---|---|---|
| `scripts/echo.py` | Echoes argv joined by space | `args=["hello", "world"]` |
| `scripts/sheet_diff.py` | Diffs two CSV files by a key column · prints JSON with adds / removes / changes | `args=["a.csv", "b.csv", "--key", "id", "--threshold", "0.2"]` |
| `scripts/word_count.py` | Counts words in stdin · returns JSON `{lines, words, chars}` | pass `stdin="..."` |

### Decision tree

- User says "echo X" → `run_skill_script(skill_id="allhands.script_demo", script="scripts/echo.py", args=[X])`
- User asks to compare two CSV files → first read both with `read_skill_file` to confirm structure, then call `sheet_diff.py`
- User pastes text and asks for word counts → `run_skill_script(... script="scripts/word_count.py", stdin=<text>)`

### Failure modes to expect

- "skill not activated" → call `resolve_skill("allhands.script_demo")` first.
- "script not found" → check the path starts with `scripts/`.
- non-zero exit → read `stderr` for the cause; CSV-not-found is a frequent cause.
- timeout → script is hung; not expected for these demos · increase only if the user asks.

### Why these scripts exist

They prove the executor stack works without depending on heavyweight third-party
libraries. `sheet_diff` is non-trivial enough to convince a reviewer that the
agent can drive a real script with structured args + multi-line stdout.

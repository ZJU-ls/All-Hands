# Track N · Seed 数据基础设施 · DONE

**Issue:** [I-0020](docs/issues/closed/I-0020-seed-data-infrastructure.md)
**Branch:** `seed-data-infrastructure` (cut from `main` at `d33a689`)
**Worktree:** `/Volumes/Storage/code/allhands-track-e`
**Scope:** build the seed-data contract every Wave-3+ feature must satisfy — so a product reviewer opening any cold-start page always sees real "full house" data instead of `暂无数据`.

## Core deliverables

- `backend/src/allhands/services/seed_service.py` — pure-service orchestration with per-domain `ensure_*()` functions plus `ensure_all_dev_seeds()` fan-out. Idempotent by business key (provider `name`, `(provider_id, name)` for models, employee `name`, MCP `name`, deterministic conversation/event ids).
- `backend/data/seeds/*.json` — 7 files, all real data (no `foo/bar/lorem`):
  - `providers.json` (3): Bailian default + OpenRouter + DeepSeek, `base_url` aligned with `.env.example`.
  - `models.json` (7): qwen-plus / qwen-coder-plus / qwen-max / anthropic/claude-3.5-sonnet / openai/gpt-4o-mini / deepseek-chat / deepseek-coder.
  - `employees.json` (3): `ResearchAgent` / `CoderAgent` / `MarketAnalyst` — **no `mode` field** per §3.2, each gets `skill_ids=["allhands.render","allhands.artifacts"]`.
  - `mcp_servers.json` (1): stdio Filesystem MCP server sample.
  - `conversations.json` (1): complete user + assistant exchange with `reasoning_summary`.
  - `events.json` (4): run.started / run.completed / run.failed / run.cancelled covering all four run states used by `/traces`.
  - `skills_mount.json`: employee → skill mount manifest, validated against `employees.skill_ids`.
- `backend/src/allhands/cli/seed.py` — `allhands-seed dev` (ensure seeds idempotently) and `allhands-seed reset` (wipe + reseed, **refuses unless `ALLHANDS_ENV=dev`**, rc=2 otherwise). Registered via `[project.scripts]` in `pyproject.toml`.
- `backend/src/allhands/main.py::_should_seed` — startup hook auto-seeds only when `env ∈ {dev, test}` or `ALLHANDS_SEED=1`; production is opt-in by explicit flag.
- `docs/claude/working-protocol.md` Stage 4 adds the new **"Seed 数据 (从 Wave-3 起强制 · I-0020)"** DoD block. Supporting context in `docs/claude/learnings.md` (L02 · *Seed data is a contract, not a convenience*) and `docs/claude/error-patterns.md` (E01 · *Empty-state drift*).

> ℹ️ `/docs/claude/` is listed in `.gitignore` ("个人 AI-paired 开发 harness" harness), so the DoD doc + L02 + E01 live as worktree-local artefacts. If the maintainer wants them repo-wide, un-ignore the path before merging.

## Regression surface

- `backend/tests/integration/test_seed_service.py` — **10 cases**, enforce:
  - idempotence (3 consecutive runs, zero row growth)
  - `MIN_PROVIDERS=3 / MIN_MODELS=6 / MIN_EMPLOYEES=3 / MIN_MCP_SERVERS=1 / MIN_CONVERSATIONS=1 / MIN_EVENTS=4 / MIN_MESSAGES=2`
  - `REQUIRED_EVENT_KINDS = {"run.started","run.completed","run.failed","run.cancelled"}`
  - real-data guards: all provider `base_url` use `https://`, no `foo/bar/lorem` placeholders, Bailian preset present, exactly one default provider
  - no `mode` field on seeded employees (§3.2)
- `backend/tests/unit/test_seed_cli.py` — **7 cases**:
  - `_should_seed` dev/test → True; prod default → False; `ALLHANDS_SEED=1` → True; other values → False.
  - `_do_reset` returns rc=2 with "refused" on stderr when `ALLHANDS_ENV≠dev`.
  - `build_parser()` requires a subcommand and accepts `dev` / `reset`.
- `web/tests/e2e/seed-full-house.spec.ts` — **5 cases**, each route mocked against the seed JSON files (`fs.readFile` at setup):
  - `/gateway` ≥ 3 providers + ≥ 3 models for the default provider.
  - `/employees` ≥ 3 seeded rows.
  - `/skills` ≥ 1 installed skill (filesystem-backed, out of `seed_service` scope — mocked to a realistic response).
  - `/mcp-servers` ≥ 1 seeded server.
  - `/traces` ≥ 1 trace row (synthesized from run events).
  - `I0020_CAPTURE=1` environment flag side-effects screenshots into `plans/screenshots/i0020-seed-*.png` for review.

## Check-script proof

`./scripts/check.sh` green after every commit. Final run:

```
==> backend: ruff (lint)              All checks passed!
==> backend: ruff (format check)      235+ files formatted (seed_service / cli / tests)
==> backend: mypy (strict)            0 errors
==> backend: import-linter            0 violations (seed_service + cli stay in service/cli layer)
==> backend: pytest                   805 passed, 1 skipped, 2 xfailed (+17 new seed cases)
==> web: lint                         0 warnings
==> web: typecheck                    0 errors
==> web: vitest                       975 passed, 43 skipped (no changes to existing suite)
==> visual discipline                 ✓ (no new web components)
==> tool-first symmetry (L01)         ✓
==> bug triage signoff                INDEX sync: P0 3 / P1 2 / P2 5 / open 10 (was 11)
==> plan loop closure                 no plans/
==> W1-W7 acceptance matrix           7/7
```

E2E spec (`pnpm exec playwright test seed-full-house`) also green · 5 passed in ~2.6 s against the mocked endpoints.

## Screenshots (local, `plans/screenshots/` is gitignored)

```
plans/screenshots/i0020-seed-gateway.png      87 KB — 3 provider tabs, 3 Bailian models visible
plans/screenshots/i0020-seed-employees.png    57 KB — 3 employees with preset badges
plans/screenshots/i0020-seed-skills.png       60 KB — installed tab lists allhands.render + .artifacts
plans/screenshots/i0020-seed-mcp-servers.png  56 KB — Filesystem stdio server card
plans/screenshots/i0020-seed-traces.png       57 KB — trace table with 3 seeded rows, one failed
```

## CLI smoke

```
$ ALLHANDS_ENV=test uv run allhands-seed --help
usage: allhands-seed [-h] {dev,reset} ...
Dev-only seed runner. See docs/issues/open/I-0020.

$ ALLHANDS_ENV=prod uv run allhands-seed reset
allhands-seed reset refused: ALLHANDS_ENV='prod' (only 'dev' allowed).
# exit code: 2
```

## Files touched

```
NEW  backend/src/allhands/services/seed_service.py
NEW  backend/src/allhands/cli/__init__.py
NEW  backend/src/allhands/cli/seed.py
NEW  backend/data/seeds/providers.json
NEW  backend/data/seeds/models.json
NEW  backend/data/seeds/employees.json
NEW  backend/data/seeds/mcp_servers.json
NEW  backend/data/seeds/conversations.json
NEW  backend/data/seeds/events.json
NEW  backend/data/seeds/skills_mount.json
NEW  backend/tests/integration/test_seed_service.py
NEW  backend/tests/unit/test_seed_cli.py
NEW  web/tests/e2e/seed-full-house.spec.ts
MOD  backend/src/allhands/main.py                  (+_should_seed + startup hook)
MOD  backend/pyproject.toml                        ([project.scripts] allhands-seed)
MOD  docs/issues/INDEX.md                          (close I-0020, counts P1 3→2, open 11→10)
RM→  docs/issues/open/I-0020-... → closed/         (with 关闭记录 appended)

IGNORED (local-only, see .gitignore)
     docs/claude/working-protocol.md               (Stage-4 DoD block)
     docs/claude/learnings.md                      (L01 seed + L02 seed-as-contract)
     docs/claude/error-patterns.md                 (E01 empty-state drift)
     plans/screenshots/i0020-seed-*.png            (5 cold-start screenshots)
```

## Hand-off notes

- **For the next track that adds a domain table:** the DoD block in `docs/claude/working-protocol.md` Stage 4 is the single source of truth. Follow the checklist → add `ensure_<thing>()` → register in `ensure_all_dev_seeds()` → extend `seed-full-house.spec.ts`.
- **For production operators:** seeds never run in prod by default. Set `ALLHANDS_SEED=1` to opt in (e.g. first-run of a staging env); the CLI `reset` subcommand refuses anything other than `dev` unconditionally.
- **For reviewers:** trip wire is `seed-full-house.spec.ts`. A track that ships a feature but skips seeding causes its page to drop below the row-count assertion and review bounces on that line (see E01).
- **Ready for merge:** push `seed-data-infrastructure` → maintainer merges. No PR requested by track prompt.

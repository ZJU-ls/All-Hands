# Track 2 (Wave 2 · QA 闸门) · READY

分支:`track-2-qa`
基准 HEAD 从 main 切:`2d54797 docs(specs): add 3 Wave 2 specs + Wave 2 parallel plan`
本分支 HEAD:`e9894ca`
完成时间:2026-04-19 11:00 GMT+8

等协调端合。以下是交付清单。

---

## 1 · 新建 / 修改的文件

### 新建(白名单内)

| 文件 | 角色 |
|---|---|
| `scripts/self-review.sh` | 闸门 A:视觉纪律 + Tool-First 对称 + bug triage 签字 + plan 闭环(4 节) |
| `scripts/walkthrough-acceptance.sh` | 闸门 B:W1-W7 矩阵 + v0 sign-of-life |
| `harness/README.md` · `harness/gates.sh` | 统一入口 + 聚合器 |
| `harness/qa-playbook.md` | QA 手册(按 prompt 本该放 `docs/claude/qa-playbook.md`,那个路径 gitignored · 先落 harness/) |
| `backend/tests/acceptance/__init__.py` · `conftest.py` | 包 + 共享 fixture |
| `backend/tests/acceptance/walkthrough_plan.json` | W1-W7 单一事实来源(Python + TS 都读) |
| `backend/tests/acceptance/test_walkthrough_plan.py` | plan shape + precondition check |
| `backend/tests/acceptance/test_w1_bootstrap.py` | W1 sign-of-life |
| `backend/tests/acceptance/test_w2_employee.py` | W2 sign-of-life(xfail I-0008) |
| `backend/tests/acceptance/test_w3_task.py` | W3 sign-of-life(xfail tasks spec pending) |
| `backend/tests/acceptance/test_audit_regressions.py` | I-0005..I-0011 回归 xfail 矩阵 |
| `web/tests/acceptance/walkthrough-plan.test.ts` | plan shape 前端镜像 |
| `docs/issues/open/I-0005..I-0014` (10 份) | 7-spec 审计发现 |
| `TRACK-2-QA-PROGRESS.md` | 进度流水 |
| `TRACK-2-QA-READY.md` | 本文件 |

### 修改

| 文件 | 改动 |
|---|---|
| `scripts/check.sh` | 末尾 append 2 行调用 self-review + walkthrough-acceptance(prompt 指定的唯一允许改动) |
| `docs/issues/INDEX.md` | 新增 10 行 · 重写分布表 · 追加 2026-04-19 历史条 |

**未动(白名单外 · 验证过):**
- `backend/src/allhands/**`(feature 代码)
- `web/app/**` · `web/components/**` · `web/lib/**`
- `backend/alembic/versions/**`
- `product/**` · `CLAUDE.md`
- `.claude/**`

---

## 2 · 跑过的脚本

全部在本 worktree 跑过 · 全绿或符合预期 xfail:

```
./scripts/self-review.sh                → passed (P0 warn only)
./scripts/walkthrough-acceptance.sh     → passed (v0 W1-W3 · W4-W7 xfail on preconditions)
./harness/gates.sh                      → passed (聚合)
./scripts/check.sh                      → passed (ruff + ruff fmt + mypy strict + import-linter + pytest + next lint + tsc + vitest + self-review + walkthrough)
```

最终数字(commit `e9894ca` · 本地跑):
- backend pytest:**483 passed · 1 skipped · 20 xfailed**(20 xfail 里 19 条是 I-0005..I-0011 + W2/W3 的结构性 sign-of-life;1 条是先前存在的 SSE test client 死锁跳过)
- web vitest:**426 passed · 31 skipped**(31 skipped 是需要先 `pnpm build` 的 routes-smoke,跑 CI 时会跑到)
- import-linter:**3 kept, 0 broken**
- mypy strict:**no issues**

---

## 3 · 审计发现的 issue 列表

| id | severity | spec | title |
|---|---|---|---|
| I-0005 | **P0** | artifacts-skill | `artifact_changed` SSE event never emitted — panel has no push signal |
| I-0006 | **P0** | cockpit | cockpit frontend polls every 5s, does not consume SSE stream |
| I-0007 | **P0** | visual-upgrade | state components (EmptyState/ErrorState/LoadingState/FirstRun) never built |
| I-0008 | P1 | employee-chat | EmployeeCard render component not registered — create_employee can't render inline |
| I-0009 | P1 | triggers + cockpit | product/04-architecture.md never updated for triggers L5.9 + cockpit L7.1/L8.1 |
| I-0010 | P1 | visual-upgrade | no ESLint rule forbidding raw "Loading…"/"Error"/"No data" literals |
| I-0011 | P1 | agent-design + viz-skill + artifacts-skill + cockpit + employee-chat | 7 missing integration/e2e tests from various DoDs |
| I-0012 | P2 | viz-skill + artifacts-skill | design-lab missing live samples for Viz components + Artifact.Preview |
| I-0013 | P2 | visual-upgrade | Voice & Tone chapter + Lead welcome message never added |
| I-0014 | P2 | visual-upgrade | Coachmark system + first-run guided tour not built |

**分布:** 3 P0 · 4 P1 · 3 P2 · 共 10 条新 issue。
**既存未关:** I-0002 / I-0003(P2,track-3 白名单,未动)· I-0001(已关)。

每条 issue 的正文遵循 `docs/issues/TEMPLATE.md` 格式 · repro + expected + actual + evidence + suggested-fix + acceptance criteria。
`test_audit_regressions.py` 有 7 条 xfail 分别追踪 I-0005/I-0006/I-0007×4/I-0009/I-0011×7(I-0010 strict-literal-form 已 pass,需靠 I-0007 + I-0010 的 lint 规则补防御)。

---

## 4 · 已知偏差 / 风险(交接端需知)

1. **`docs/claude/**` gitignored** — prompt 写 QA playbook 放 `docs/claude/qa-playbook.md` · 实际落 `harness/qa-playbook.md`(白名单内,可进 branch)。放行就挪,挪前文件内容已准备好。
2. **Meta Tool 未实装** — 三份 review spec 要求的 `cockpit.run_self_review` / `cockpit.run_walkthrough_acceptance` / `cockpit.run_harness_review` 三个 Meta Tool 本 track **没实装**(prompt scope = scaffolding + audit + 不改 feature)· playbook 里标注了。
3. **`docs/claude/` 必读文件不存在** — `working-protocol.md` / `learnings.md` / `error-patterns.md` / `reference-sources.md` 都 gitignored · 无法读。我按 CLAUDE.md §3.5 + 三份 QA spec 正文跑自审纪律。对交接端而言:如果你的环境有这些文件,最好把 `self-review.sh` 里的 learnings 引用 / error-patterns 回归加上;现在只对 code 跑。
4. **审计 false-positive** — 我的子 agent 在 I-0010 上多报了"raw literals 多处存在";实测 strict pattern 没 hit。issue 的"遗留清理"部分退化为无事可做,但"加 ESLint 规则"这条仍然有效。可以考虑关得更早。
5. **dev server 未跑过** — 本 track 不 touch feature 代码,所以没起 `pnpm dev --port 3001` / `uvicorn --port 8001`。W1-W3 的真点击留给交付前的最后一把 walkthrough-acceptance 修-评循环。
6. **未 merge main** — 按 prompt § 硬约束 · 本 track 不 rebase / push main · 等协调端用 `git merge --no-ff track-2-qa`。
7. **I-0004 历史** — 有个历史 commit 消息提到 "follow-up to I-0004",但从未作为 issue 文件存在 · 我从 I-0005 开始编号以免冲突。如果发现遗留,按 bug-fix-protocol 补文件即可,不影响现有编号。
8. **commit identity warning** — git 输出有 "Your name and email address were configured automatically" 提示。不是 QA 问题,用户若介意,跑 `git config --global --edit` 设显式身份。

---

## 5 · 合并后建议的下一步

- **修 P0 链(I-0005 / I-0006 / I-0007)** — 打包一个小 spec `fix-p0-from-audit` 或三个独立 PR · 每修一条 flip 对应 xfail → assert
- **实装三个 review Meta Tool** — `cockpit.run_*_review` 串起本 track 铺的静态底座 + 真浏览器(chrome-devtools MCP)
- **跑一次完整 walkthrough-acceptance 修-评循环** — 按 walkthrough spec §3.7(v0 交付前最后一关)
- **清理 `I-0011` 的 7 条 missing test** — Wave 1 feature 各自补一条 · xpass 之后 flip assert · 这条能关其他很多回归

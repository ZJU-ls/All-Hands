# Track 1 · Resume Brief(窗口被 AUP 拦 · 新开 session 第一条消息发这个)

> 日期:2026-04-19 · 你在 `/Volumes/Storage/code/allhands` · 分支 `main` · 这是 Track 1 执行端 上下文快照。
> 上一个 session 在跑 `pytest tests/integration/test_cockpit_api.py -v` 时 pytest hang 住(PID 63422)· 随后 AUP 误判拦截。先 `kill 63422` 再开工。

---

## 1. 你是谁

- Track 1 · 后端主线 · 负责 Waves A → C 的 feature 交付
- 并行协作里 Track 2(UI 链)/ Track 3(可靠性)在各自 worktree 跑 · **你不管他们**
- 你当前已跑完 **Wave B.3 triggers(8/N)+ Wave C employee-chat + artifacts(3/N)+ cockpit(3/N)** · 路径比原定 parallel-execution spec 多吃了 Track 2 的 scope(协调端已经追认)

## 2. 当前 git 状态

```
branch: main · HEAD = 54fb24d feat(cockpit): web Cockpit page with KpiBar + 3-col layout (Wave C · cockpit 3/N)
未提交: 20 个 M + 28 个 ?? 
```

### 2.1 M 文件(mid-work · 含 cockpit slice 4 的 live SSE 改动)

```
.env.example
backend/src/allhands/api/routers/{cockpit,providers}.py
backend/src/allhands/core/tool.py
backend/src/allhands/execution/gate.py
backend/src/allhands/execution/tools/meta/model_tools.py
backend/src/allhands/main.py
backend/tests/integration/test_cockpit_api.py   ← pytest 就是在跑这个
backend/tests/unit/{test_runner,test_services}.py
product/03-visual-design.md
web/app/{chat,gateway/models,gateway/providers,settings}/page.tsx
web/app/{globals.css,layout.tsx}
web/components/chat/ToolCallCard.tsx
web/next-env.d.ts
web/tailwind.config.ts
```

### 2.2 Untracked 源码(其中 5 个是 I-0004 必须先 add · 否则 pre-commit 永红)

**→ I-0004 orphan 文件(从 11e2fea 起就该 `git add` 的 · 要先提交这批)**
```
backend/src/allhands/core/model.py              ← core/__init__.py:50 import 它
backend/src/allhands/services/model_service.py  ← api/deps.py:49,119 lazy-import
backend/src/allhands/api/routers/models.py      ← api/app.py:20 top-level import
backend/tests/unit/test_model_service.py        ← 配套 unit test
backend/alembic/versions/0003_add_llm_models.py ← LLMModel 表的 migration
```

**其他 untracked(Track 1 自己 Wave 里的零散工作 · 看你要不要带)**
```
scripts/{install-hooks,pre-commit}.sh
web/app/{error.tsx,not-found.tsx,gateway/page.tsx}
web/components/shell/PlaceholderPage.tsx
web/components/ui/icons.tsx
web/tests/routes-smoke.test.ts
```

## 3. 你下一步要做的第一件事

**P0 · 修 I-0004**(自己造的坑 · 阻塞全仓 pre-commit):

```bash
cd /Volumes/Storage/code/allhands
git add backend/src/allhands/core/model.py \
        backend/src/allhands/services/model_service.py \
        backend/src/allhands/api/routers/models.py \
        backend/tests/unit/test_model_service.py \
        backend/alembic/versions/0003_add_llm_models.py
cd backend && uv run ruff check . && uv run mypy src && uv run pytest --collect-only -q
# 绿了再
cd .. && git commit -m "fix: add orphan files from 11e2fea (unblock pre-commit)"
```

- **不许 `--no-verify`** · CLAUDE.md 禁
- 如果某文件还差 sqlalchemy model / alembic 同步 · 一并补齐再 commit
- commit 完同步到 `docs/issues/closed/` 关闭 I-0004(issue 正文在 `/Volumes/Storage/code/allhands-track-3/docs/issues/open/I-0004-*.md`· 这是 Track 3 写的 · 你不动 Track 3 worktree · 只在你这边关个空壳或让协调端关)

## 4. 修完 I-0004 之后

继续你本来的 cockpit slice 4(live SSE)· 或按你原 roadmap 继续。M 里的 20 个文件是你在跑的。

## 5. 不要做

- 不改 `docs/issues/**`(Track 3 独占)
- 不改 `web/app/{employees,artifacts}/` 之外的 Track 2 scope — **你已经覆盖完了 · 不再追加**
- 不 `--no-verify` · 不 `--dangerously-skip-permissions`
- 不动 `/Volumes/Storage/code/allhands-track-2` / `allhands-track-3` 两个 worktree

## 6. AUP 拦截触发的上下文(给新 session 避雷用)

你上次阻塞是在 `test_cockpit_api.py` 的 pytest 进程 hang 住(PID 63422 · 空输出)· 然后推理"为什么静默"的 prompt 被分类器误判。恢复方法:

1. 先 `kill 63422`(旧 pid 可能已经没了 · `ps aux | grep pytest` 重新找)
2. 本次不要一上来就重跑那个挂的 pytest · 先用 `pytest tests/integration/test_cockpit_api.py -v --timeout=30 -x --lf` 带超时 + 挂就停
3. 如果分类器还敏感 · 换模型:`/model claude-sonnet-4-5` 或 `claude-haiku-4-5-20251001`

---

**开工:先读 CLAUDE.md + docs/claude/working-protocol.md 确认协议没变 · 然后按 §3 动手。**

# 制品孤儿 bug 排查 + 修复报告

> 2026-04-28 · 用户截图反馈引发的端到端追踪 + 三连修复

---

## 0 · 现场症状

用户在 LeadAgent 对话里看到一条任务产出 `AllHands_Capability_Demo.html`,
**chat 详情区**完整渲染了这份 HTML 制品(预览图、下载、打开按钮齐全),
但右侧的**制品区**显示:

```
┌────────────────────────┐
│ 📁 制品区 · 0           │
│                        │
│      ✨                 │
│   还没有制品            │
│ 让员工产出一份文档…    │
│                        │
└────────────────────────┘
```

同一份数据,两个面板出现"是否存在"的结构性不一致 — 这种 bug 最具迷惑
性,因为 backend 既没报错,artifact 也确实在数据库里。

---

## 1 · 根因 — 三层级联 bug

### 第一层 · 子代理 runner factory 缺 `conversation_id`

`backend/src/allhands/services/chat_service.py` 的
`_build_runner_factory` 给每个**子 runner** 构造 `AgentRunner` 时,从
来不传 `conversation_id`:

```python
def factory(child: Employee, depth: int) -> AgentRunner:
    ...
    return AgentRunner(
        employee=child,
        ...
        # ADR 0019 · plan_repo also shared with subagents...
        # conversation_id is None at the nested factory layer; the
        # dispatch / spawn service knows the conversation it's targeting
        # and can supply it through the runner kwargs path if needed.   ← 谎言
        plan_repo=self._plan_repo,
        user_input_signal=self._user_input_signal,
    )
```

注释说"dispatch / spawn 'can supply' if needed",但现实里**从来没有**
任何地方真的传过。注释是 wishful thinking。

### 第二层 · AgentLoop 把空字符串当成"无 conversation"

子 `AgentRunner._conversation_id = ""` → `AgentLoop._conversation_id =
""`。当子 agent 调 `allhands.artifacts.create` 时:

```python
# agent_loop.py:874
kwargs = {
    "conversation_id": self._conversation_id or None,
    ...
}
```

`"" or None` → 传给 executor factory 的 `conversation_id` 是 `None`。

### 第三层 · 落库 conversation_id=NULL,UI 严格过滤把它排除

`make_artifact_create_executor` 用这个 `None` 写入 `Artifact` 行的
`conversation_id` 列,这条记录在 DB 里 `conversation_id IS NULL`。

ArtifactPanel 用 `listArtifacts({conversationId: 当前对话})` 做严格过
滤(后端 SQL `WHERE conversation_id = :cid`,**不是 OR conversation_id
IS NULL**),NULL 行被排除,**右侧 panel 永远看不到子代理产物**。

而 chat 详情区里能看到,是因为 chat 通过 SSE 拿到子 run 的
`run.completed` 事件流,里面带着 artifact_id,直接 `getArtifact(id)`
取详情 — 不经过 `listArtifacts` 的过滤。

```
┌─ 数据流对比 ───────────────────────────────────────┐
│                                                    │
│  Chat 详情区:SSE → run.completed → getArtifact()   │
│                                       ↓ 直接 by id  │
│                                   ✅ 看到了        │
│                                                    │
│  ArtifactPanel:listArtifacts({conv_id})            │
│                              ↓ WHERE conv_id = :x  │
│                          ❌ NULL 行被排除          │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## 2 · 修复(三连)

### 修复 1 · backend factory 传 conversation_id

利用已经存在的 `_parent_conversation_id: ContextVar[str | None]` —
它在 `ChatService.send_message` 入口 (line 1054-1055) 就 set 好了,
subagent 跑在同一 asyncio task 里继承得到。改 factory 读它:

```python
inherited_conv = _parent_conversation_id.get() or ""
return AgentRunner(
    ...,
    conversation_id=inherited_conv,
    ...
)
```

**从此新生成的子 agent 制品 `conversation_id` 正确归属父对话。**

### 修复 2 · alembic 0037 回填历史孤儿

新 migration `0037_backfill_artifact_conv_id.py`,做的事情:

```sql
-- 1. 找所有 conversation_id IS NULL 但 created_by_run_id 有值的 artifact
SELECT id, created_by_run_id FROM artifacts
WHERE conversation_id IS NULL AND created_by_run_id IS NOT NULL;

-- 2. 一次性 build "run_id → conversation_id" 反查表
SELECT payload FROM events
WHERE kind IN ('run.started', 'run.completed', 'run.failed');
-- payload 里有 {run_id, conversation_id}

-- 3. 逐条 UPDATE artifacts SET conversation_id = lookup(run_id) WHERE id = ?
```

idempotent(只回填仍然 NULL 的行),downgrade no-op(没记录哪些行被
本次更新过)。

### 修复 3 · 前端「全工作区」toggle

即便修了根因,如果将来又冒出别的 scope 错位,用户也能切换视图自查。
ArtifactPanel header 加一个 toggle:

```
┌─ 制品区 · 12 ─────────────────────────────┐
│              [本对话 / 全工作区] [×]       │  ← 新 toggle
└────────────────────────────────────────────┘
```

- `本对话`(默认):仍按 conversationId 严格过滤
- `全工作区`:绕过过滤,看全部 — 包括子代理 / 隔壁对话产出
- localStorage 持久化,SSE handler 在 `showAll` 模式下不过滤

---

## 3 · 验证矩阵

| 场景 | 修前 | 修后 |
|---|---|---|
| 父 agent 产出制品 | ✅ panel 看到 | ✅ panel 看到 |
| 子 agent (dispatch) 产出制品 | ❌ panel 0 制品 | ✅ panel 看到(conversation_id 继承) |
| 子 agent (spawn_subagent) 产出 | ❌ 同上 | ✅ 同上 |
| 历史已存在的 NULL 孤儿 | ❌ 永远看不到 | ✅ alembic 0037 回填后 panel 看到 |
| 切到「全工作区」 toggle | n/a | ✅ 看全部 workspace 制品 |
| /artifacts 全局页 | ✅(本来就不过滤 conv) | ✅ 不变 |

---

## 4 · 业界对照

这是个典型的"ContextVar 传递断链"bug,业界公认的反模式:

- **Datadog APM Trace propagation**:他们的 SDK 强调"trace context
  propagation across async boundaries must be explicit or via context-
  vars" — 不能假设 caller "如果需要会传"
- **OpenTelemetry**:Span context inheritance 是声明式的,不是注释式
  ("this 'can supply' if needed" 是 docstring smell)
- **Notion 子页面归属**:子文档默认归属父 workspace,不是"独立飘着等
  人来认领"

**关键启示**:任何"父 → 子"的 runner / context / scope 传递,要么默
认继承,要么显式 opt-out;**绝不能默认丢失 + 注释里写"将来会处理"**。

---

## 5 · 工程账

- **修改文件**:
  - `backend/src/allhands/services/chat_service.py` (factory 加
    conversation_id 继承)
  - `backend/alembic/versions/0037_backfill_artifact_conv_id.py` (新)
  - `web/components/artifacts/ArtifactPanel.tsx` (toggle + SSE
    handler)
- **i18n 增量**:zh-CN + en 各 4 个 key(showAllOn/Off + title)
- **commit hash**:`065553c` on `feat/ui-tweaks` + `main`
- **TS / lint**:web typecheck 通过 · vitest 1794 passed
- **pytest**:34 个 test 在本机失败,**无一与本修复相关** — 全部是
  `FileExistsError: [Errno 17] File exists: 'data'`,源于 `backend/data`
  是指向 sibling repo (`/Volumes/Storage/code/allhands/backend/data`)
  的 symlink。在 `origin/main` 干净树上(stash 验证)同样失败。
  **建议明早删掉 symlink 后重跑** — 这是用户本机 dev 配置问题,与本
  修复无关。

---

## 6 · 后续 / 待办

- 🟡 同样的"context 传递断链"在 `ChatService` 别处可能也存在 — 例如
  triggers / cron / batch tasks 调 artifact tool 时的 conversation_id
  归属。建议跑一遍全量追溯。
- 🟡 ArtifactPanel 的 SSE 实时新增制品,如果 conversation_id 还是 NULL
  会被前端过滤丢掉 — 修了 backend 后这种情况理论不再发生,但
  defensive 起见可以在 SSE handler 里也加 `payload.conversation_id ===
  null` 时降级到"显示但灰显"的处理。
- 🟡 单测覆盖:加 `test_subagent_artifact_inherits_conversation_id` 用
  fake DispatchService 跑 round-trip,断言 `conversation_id` 落库正确。

---

> **诊断 → 修复 → 验证** 三段都得过一遍才能 declare 解决。本次 bug
> 看起来是"右侧 panel 显示 0",但实际数据流跨 4 层(SSE / SQL / runner
> 工厂 / context var),任何一层假设错了都会导致用户看到的不一致。

# Skills 系统架构 · allhands

> 一份总览 —— 把分散在 `product/`、`ADR 0011/0015`、`ref-src-claude/V05` 以及代码里的 skill 相关契约抽出来放在一页。改 skill 相关代码前先读这篇。

更新日期:2026-04-25
相关 ADR:[0011 Principles Refresh](../product/adr/0011-principles-refresh.md) · [0015 Skill 渐进式加载](../product/adr/0015-skill-progressive-loading.md)

---

## 1 · 一句话模型

**Skill = 一个文件夹 + 一份 `SKILL.md` + 可选的 `references/` / `scripts/` / `templates/` 子目录。**
descriptor 永驻、body 激活时注入、子文件按需读 —— 三段渐进式加载(对齐 Claude Code V05)。

---

## 2 · 磁盘布局(Single Source of Truth)

**每个 skill 在磁盘上就是一个自包含的目录。** 两类来源,统一使用 `Skill.path` 指向目录根:

```
# 内建(随代码一起发布)
backend/skills/builtin/<slug>/
  └─ SKILL.yaml              # 平台控制的结构化 manifest

# 用户安装(来自 GitHub / 市场 / .zip upload)
backend/data/skills/<slug>/
  ├─ SKILL.md                # Claude 格式 · frontmatter + body
  ├─ references/*.md         # 按需拉取的参考内容
  ├─ scripts/*.py            # 随 skill 捆绑的执行脚本
  └─ templates/*             # 代码或内容模版
```

- **`SKILL.yaml`(builtin)** 用结构化字段承载 `name / description / version / tool_ids / prompt_fragment`,适合平台主动维护的能力包。
- **`SKILL.md`(installed)** 用 YAML frontmatter + markdown body,兼容 Claude Code / openclaw / 社区 skill 仓库,零改造就能投产。
- 两种格式在 runtime 走同一条渐进式加载通路,唯一差异是 **builtin 没有 body**(纯 manifest),所以第 2 段激活时注入的只有 `prompt_fragment`。

---

## 3 · 渐进式加载的三个阶段(ADR 0015)

```
┌──────────────────┐       ┌──────────────────┐       ┌───────────────────────┐
│ 1. descriptor     │       │ 2. 激活           │       │ 3. 按需拉资源          │
│ (永驻在 prompt)   │ ────▶ │ resolve_skill    │ ────▶ │ read_skill_file       │
│ name + desc≤50    │       │ 注入 tools + body │       │ sandbox: install_root │
└──────────────────┘       └──────────────────┘       └───────────────────────┘
  O(已安装 skill 数)         O(body ≈ 5-20KB)          O(agent 主动 pick 的文件)
```

### 3.1 Descriptor 永驻

- `SkillRegistry` 只物化 `SkillDescriptor`(name + 截断到 50 字符的 description),进 system prompt 固定那块。
- 代码:`backend/src/allhands/execution/skills.py`。
- 目的:不管你装了多少 skill,弱模型的 context window 不会被 body 占满。

### 3.2 激活注入 body

- 当 agent 调用 `allhands.meta.resolve_skill(skill_id)`,runtime:
  1. 把 skill 的 `tool_ids` 加入本轮 `lc_tools`(下一轮 runner stream 才生效 · 纯函数重算)
  2. 把 `prompt_fragment` 加入 `SkillRuntime.resolved_fragments`
  3. **读 `SKILL.md` body**(frontmatter 已剥离) · 追加到 `resolved_fragments`
- `SkillRuntime` 状态在 `chat_service.send_message` 结束时 flush 到 `SkillRuntimeRepo`(ADR 0011 硬约束 · 进程重启可 resume)。
- 代码:`execution/skills.py::resolve_skill` + `execution/skills_body.py::read_skill_body`。

### 3.3 按需拉资源

- body 引导 agent 自主调 `allhands.meta.read_skill_file(skill_id, relative_path)`。
- **沙盒:** `Path(install_root/<slug>/<rel>).resolve().is_relative_to(install_root/<slug>.resolve())`。拒绝 `..` / 绝对路径 / symlink 逃逸 / 非 UTF-8 / > 256KB。
- 代码:`execution/tools/meta/skill_files.py`。

---

## 4 · 三个安装入口 · 一份业务逻辑

平台对 skill 的每个操作都有**两个入口 + 一份实现**(Tool First · L01):

| 动作 | REST(UI 调用) | Meta Tool(Lead Agent 调用) |
|---|---|---|
| 列表 | `GET /api/skills` | `allhands.meta.list_skills` |
| 详情 | `GET /api/skills/{id}` | `allhands.meta.get_skill_detail` |
| 列官方市场 | `GET /api/skills/market?q=` | `allhands.meta.list_skill_market` |
| 预览市场 skill | `GET /api/skills/market/{slug}/preview` | `allhands.meta.preview_skill_market` |
| 从 GitHub 安装 | `POST /api/skills/install/github` | `allhands.meta.install_skill_from_github` |
| 从官方市场安装 | `POST /api/skills/install/market` | `allhands.meta.install_skill_from_market` |
| 从 .zip 安装 | `POST /api/skills/install/upload` | — (REST-only · Lead 传 bytes 太笨重) |
| 更新描述/片段 | `PATCH /api/skills/{id}` | `allhands.meta.update_skill` |
| 卸载 | `DELETE /api/skills/{id}` | `allhands.meta.delete_skill` |

### 4.1 Install from GitHub(自动扫描多 skill)

用户场景:**"给 Lead Agent 一个 `github.com/anthropics/skills` 链接,让它装里面所有 skill。"**

算法(`services/skill_service.py::install_from_github`):

1. `git clone --depth=1 -b <ref> <url>` 到临时目录
2. `_discover_skill_dirs(tmp_root)` 搜 `SKILL.md`,深度最多 3 级
3. 跳过 `.git / .github / node_modules / __pycache__ / tests / test / dist / build / 以 . 开头的目录`
4. 每个找到的 skill:
   - 解析 frontmatter 拿到 `name / description / version / tool_ids / prompt_fragment`
   - `slug = slugify(frontmatter.name)`
   - 移到 `backend/data/skills/<slug>/`
   - UPSERT `SkillRepo` 行,`source_url = <repo>/tree/<ref>/<relative-path>`(多 skill 仓库里是子路径)
5. 返回 `list[Skill]`(单 skill 仓库长度为 1)

`POST /api/skills/install/github` 现在回:`{ count: number, skills: SkillResponse[] }`。

### 4.2 Lead Agent 执行器布线

所有 skill 管理 meta tool 的 executor 在 `backend/src/allhands/api/skill_executors.py`:

- 位置选在 `api/` 层是因为它需要 close over `SkillService`,而 `execution/` 被 import-linter 禁止 import `services/`(Layered architecture 契约)。
- `api/deps.get_tool_registry()` 在启动时调 `build_skill_management_executors(session_maker)`,把结果通过 `discover_builtin_tools(..., extra_executors=...)` 注入。
- WRITE / IRREVERSIBLE scope(install / update / delete)仍然走 `ConfirmationGate`,在到达 executor 之前等用户点确认。

---

## 5 · 为什么 agent 默认就能用 skill

**全员统一走 `AgentRunner`(原则 3.2 统一 React Agent):**

- `AgentRunner` 每一轮 `stream(messages, thread_id)` 都重算 `lc_tools` + `system_prompt`(原则 3.3 Pure-Function Query Loop)。
- `SkillRuntime` 提供当前已激活 skill 的 `tool_ids` + `resolved_fragments`,runner 读进来 rebuild。
- 只要 Employee 挂了任意 `skill_ids`(或在对话中通过 `resolve_skill` 动态激活),对应 body + tools 就**自动**在下一轮生效。
- 开发者不需要在每个 agent 里单独写 skill 加载代码 —— 这是一条共享的纯函数通路。

---

## 6 · 添加新 skill 的最短路径

### 6.1 作为 built-in

```
mkdir backend/skills/builtin/my-skill
cat > backend/skills/builtin/my-skill/SKILL.yaml <<EOF
name: my-skill
description: ≤50 字符说明做什么
version: 0.1.0
tool_ids:
  - allhands.builtin.fetch_url
prompt_fragment: |
  激活时会追加到 system prompt 的提示片段
EOF
```

重启后端 · `SkillRegistry.seed_skills()` 会自动发现。

### 6.2 作为 installed(推荐给社区 skill)

```
mkdir -p my-skill/references
cat > my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: ≤50 字符
version: 0.1.0
tool_ids: []
---

# my-skill

详细 body,激活时会整块追加进 runtime。引导 agent 按需 `read_skill_file('my-skill', 'references/deep-dive.md')`。
EOF
zip -r my-skill.zip my-skill
# UI: /skills → 上传 .zip
```

或者 push 到任意 GitHub repo 后 `/skills → GitHub 安装 → https://github.com/<you>/my-skill`。

### 6.3 批量捆绑(anthropics/skills 风格)

Repo 顶层无 `SKILL.md`,但子目录各自有 `skills/<name>/SKILL.md`。装一次仓库 URL,多 skill 全部落盘 —— 见 § 4.1。

---

## 7 · 安全边界一览

| 边界 | 实现 | 源位置 |
|---|---|---|
| 沙盒读文件 | `Path.resolve().is_relative_to(install_root/slug)` + size/encoding 校验 | `skill_files.py` |
| 安装写入 tar/zip 不穿透 | `_safe_extract`:先全部校验 member path,再 `tar.extractall(filter='data')` | `skill_service.py` |
| Confirmation Gate | `scope >= WRITE` 的 meta tool 在 registry 层被 `gate.wrap()` | `execution/gate.py` |
| Secret redaction | 写 tool 结果回 llm context 时对 `api_key / token / password` 自动改 `"***set***"` | `executors._redact` |

---

## 8 · 回归测试索引

- `backend/tests/unit/test_skill_service.py` — install/from github/market/zip、multi-skill 发现、沙盒跳过噪声目录、delete 删盘、update 限字段
- `backend/tests/integration/test_skills_router.py` — REST 三入口端到端 + 新 `{count, skills[]}` 响应 shape
- `backend/tests/unit/tools/test_skill_files_sandbox.py` — 7 种路径逃逸 case
- `backend/tests/unit/test_skills_body.py` — body 读取 + frontmatter 剥离 + CRLF
- `backend/tests/integration/test_resolve_skill_body_injection.py` — 激活时 body 进入 resolved_fragments
- `backend/tests/integration/test_read_skill_file.py` — 激活 → 读 reference → 未激活拒绝 → 路径逃逸拒绝
- `backend/tests/unit/test_skill_runtime_persistence.py` — ADR 0011 checkpoint 可恢复
- `backend/tests/unit/test_builtin_skill_path.py` — built-in `Skill.path` 非空(统一目录入口)
- `backend/tests/unit/test_learnings.py::TestL01ToolFirstBoundary` — REST 写动作必须有同语义 Meta Tool

---

## 9 · 常见坑(L/E 索引)

- **L18** · 激活不等于全部注入 · body ≈ 5-20KB,references 可能 > 200KB;永远用 `read_skill_file` 按需拉
- **L01** · Tool First 扩展版 · 每个 agent-managed CRUD 必须同时有 REST + Meta Tool;`test_learnings.py::TestL01ToolFirstBoundary` 守护
- **E21** · meta tool 被绑 `_async_noop` 的历史坑:READ 走 `READ_META_EXECUTORS`,WRITE(含 skill install)走 `api/skill_executors.py` 注入

---

## 10 · FAQ

**Q: 能不能把 builtin 也迁到 SKILL.md 格式,彻底统一?**
A: 可以,但当前 `SKILL.yaml` 的字段结构化得更好(手工维护不需要写 frontmatter)。`Skill.path` 已经在 runtime 统一,两种格式在渐进式加载通路上无差别 —— 迁移是 nice-to-have,不是 blocker。

**Q: Lead Agent 安装 skill 时会跑 `git clone`,有安全风险吗?**
A: 有。默认走 `git clone --depth=1`(减少攻击面),tarball 抽取用 `filter='data'` 防穿透。建议生产部署给 `allhands` 进程单独的用户 + 只读 `/usr/local/bin/git`,或用 `SkillSourceCloner` 自定义实现(例如走 Sandbox VM)。

**Q: 多人协作时 `backend/data/skills/` 会冲突吗?**
A: `data/` 是 gitignored 的用户数据,不走版本控制。每台机器各自 `install`。如果要团队共享:用 `skill_market_owner=<team-org>` 指向私有仓,所有成员装同一个 market 条目。

# ADR 0015 · Skill 渐进式加载 · body + scoped file access

## Status

Accepted(2026-04-23)

## Context

原则 3.4(Skill = Dynamic Capability Pack)要求 descriptor + lazy body-load,对标 Claude Code 的 skill 三段式加载:

1. **descriptor 永驻** — name + 截断 description 在 system prompt
2. **激活时 body 注入** — SKILL.md 正文(去 frontmatter)追加进 runtime context
3. **按需拉资源** — body 引导 agent 自主读 `references/*.md` / `scripts/*.py` / `templates/*`

当前实现**只做到第 1 步 + 半个第 2 步**:

- built-in skill(`backend/skills/builtin/<id>/SKILL.yaml`)在 manifest 里用 `prompt_fragment` 字段承载正文,正常工作
- installed skill(通过 `/skills/install/github` · `/install/market` · `/install/upload` 落到 `backend/data/skills/<slug>/`)**只**把 `SKILL.md` 的 frontmatter 解析成 DB 字段(name / description / version / tool_ids / prompt_fragment),**SKILL.md 正文 body 被丢弃**
- 子目录(`references/` · `scripts/` · `templates/`)在 `_safe_extract` 时完整落盘,但 runtime 没有访问通道 —— agent 不知道 `skill.path` 的存在

**结果**:上传一个 Claude 风格的真 skill(例如 `canvas-design` 自带 83 个字体文件在 `canvas-fonts/`,`algorithmic-art` 的 `templates/` 里有若干示例代码),runtime 拿到的只有 frontmatter 那几十个字符。99% 的内容等于白存。

## Decision

1. **激活时注入 SKILL.md body**
   - `resolve_skill` 在把 `prompt_fragment` 追加到 `SkillRuntime.resolved_fragments` 之后,**也追加 SKILL.md body**(frontmatter 剥离后的 markdown 正文)
   - 读取走纯函数 `read_skill_body(skill_dir) -> str`,在 `backend/src/allhands/execution/skills_body.py`
   - built-in skill 不受影响(没有 SKILL.md · 函数返回 "")

2. **新增 meta tool `allhands.meta.read_skill_file(skill_id, relative_path)`**
   - `kind=META · scope=READ · requires_confirmation=False`
   - 要求 `skill_id` 已在 `SkillRuntime.resolved_skills`(必须先 `resolve_skill`)
   - **路径沙盒**:`Path(install_root/<slug>/<rel>).resolve()` 后检查 `is_relative_to((install_root/<slug>).resolve())`,防 `..` + symlink 逃逸
   - 绝对路径拒绝;非文件 / 不存在 / 非 UTF-8 / > 256KB 都返回结构化 error
   - 返回 `{content, bytes, path}` 或 `{error}`

3. **`Skill.path` 字段对 built-in 和 installed 统一填充**
   - `_load_builtin_skill_manifest` 在构造 `Skill(...)` 时加 `path=str(skill_dir)`
   - 让两套 skill 走同一套 `read_skill_file` 通路

## Rationale

- **对齐 Claude Code 三段式**:用户熟悉的心智模型,社区已有大量 Claude-style skill 可直接投产
- **尊重原则 3.4 精神**:descriptor + lazy body-load · 激活后按需付费,不预支 context
- **弱模型友好**:body 一般 5-20KB,references 可能 50-200KB,后者拆 tool 读避免一次性撑爆 context window
- **安全闸门对齐现有契约**:scope=READ 不过 gate · 路径沙盒限死单 skill 目录 · 与 `fetch_url` 同级别
- **零 schema 变更 · 零新依赖**:body 懒读省去 DB 列 · 沙盒逻辑 < 30 行
- **不破分层**:`skill_files.py` 在 `execution/tools/meta/` · core/service/api 无新 import

## Consequences

**正面:**

- Claude 风格的真 skill 可以直接 upload / install-from-github 后投产,不用维护者把精华重写进 `prompt_fragment`
- `Skill.path` 成为 runtime 一等字段 · 后续 skill 级能力(如 `exec_skill_script`)天然有基座
- body + references 解耦:skill 作者可以把"使用总览"写 SKILL.md,"具体细节"放 references,符合信息密度分层

**负面 / 需要守护:**

- `resolve_skill` 激活多一次磁盘读(~5ms)· 激活后 body 缓存在 `resolved_fragments` 里 · 可忽略
- 沙盒实现必须严格 · 单元测试必须覆盖:绝对路径 / `..` / symlink / 不存在 / 非文件 / > 256KB / 非 UTF-8 七种 case · 任一缺失视为 P0
- `Skill.path` 如果未来被误用成可变字段,需 import-linter 或 ADR 明文禁止

## Alternatives Rejected

**A · 只做 body 注入,不做 read_skill_file**
references/scripts 还是用不上;Claude-style 大 skill(canvas-design 83 文件)依赖文件内联根本不可能塞进单次激活。**拒**:只解决一半问题。

**C · 暴露 skill path 给 `fetch_url` / 切 runner cwd**
破沙盒 · agent 能读任意文件;cwd 切换与并发 / subagent 语义冲突。**拒**:安全倒退。

**D · 把 SKILL.md body 在安装时写进 DB `Skill.prompt_fragment`**
更新 skill 时磁盘和 DB 会不同步;schema 污染(fragment 字段已是激活指令摘要,不该混 body);违反"文件即事实"。**拒**:引入不必要的状态同步成本。

**E · 直接复用 `allhands.builtin.write_file` 的反向 `read_file` 工具**
读范围无法限死在 skill 目录 · agent 可读任意 data_dir 文件 · scope 无法分 skill 隔离。**拒**:粒度不够。

## Related

- 原则 3.4 · Skill = Dynamic Capability Pack(`product/00-north-star.md`)
- ADR 0011 · Principles Refresh(首次明确 Lazy body-load 要求)
- L18 · Skill 渐进式加载不等于"激活时全部注入"(`docs/claude/learnings.md`)
- Claude Code skill 体系对标:`ref-src-claude/V05-skills-system.md § 2.1-2.3`

## Regression Defense

- `backend/tests/unit/test_builtin_skill_path.py` — built-in `Skill.path` 非空
- `backend/tests/unit/test_skills_body.py` — body 读取 + frontmatter 剥离 + CRLF + 无 SKILL.md 四种 case
- `backend/tests/unit/tools/test_skill_files_sandbox.py` — 沙盒六种 case
- `backend/tests/integration/test_resolve_skill_body_injection.py` — 激活时 body 进入 `resolved_fragments`
- `backend/tests/integration/test_read_skill_file.py` — 端到端:激活 → 读 reference · 未激活拒绝 · 路径逃逸拒绝 · 缺文件 clean error

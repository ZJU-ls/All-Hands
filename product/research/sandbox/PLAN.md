# allhands 本地执行能力 · 实现方案

> 路线 = **完全对齐 Claude Code**:本地宿主直接执行 · 权限文件 + 可视化权限页 + Skill 驱动 Python 完成业务场景。
> 取代上一版 [REPORT.md](REPORT.md) 中的容器沙箱主线(那是多租户场景,现不需要)。
> 2026-04-25 · branch: research/sandbox

---

## 0. 一图看懂

```
       ┌─────────────────────────────────────────────────────────┐
       │                       Lead Agent                        │
       │   拿到任务 · 决定 ① 激活哪个 skill ② 调哪些 tool         │
       │                ③ 必要时调 meta tool 改权限              │
       └────────┬──────────────────┬───────────────┬─────────────┘
       activate │            call  │          call │
                ▼                  ▼               ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
   │ Skill(能力+知识)│  │ Local Executor   │  │ Meta Tool          │
   │ excel-ops        │  │ local.bash       │  │ permission_grant   │
   │ file-organize    │  │ local.read/write │  │ permission_revoke  │
   │ cleanup-junk     │  │ local.edit       │  │ permission_test    │
   │ code-edit        │  │ local.glob/grep  │  └─────────┬──────────┘
   │ pdf-extract      │  │ local.run_python │            │
   └──────────────────┘  └────────┬─────────┘   改 JSON │
                                  │                      ▼
                       ┌──────────▼──────────┐  ┌──────────────────────┐
                       │  PermissionGate     │◄─┤ permissions.json     │
                       │  读规则 → 决策      │  │ (单一 SoT · 三入口同) │
                       └──────────┬──────────┘  └──────────────────────┘
                       allow / ask(Confirmation 弹"总是允许")/ deny
                                  │
                                  ▼
                       ┌──────────────────────────────────────┐
                       │   宿主进程(用户机器 · cwd 限定)     │
                       │   Python · git · ripgrep · libreoffice│
                       │   (可选)sandbox-exec / Landlock      │
                       └──────────────────────────────────────┘

       三入口改同一份 permissions.json:
       (a) UI Settings 页拖卡片 → API
       (b) Confirmation 弹窗 "总是允许" 按钮 → API
       (c) Lead Agent 调 meta tool → 同一 service 函数
```

核心三件套:**Local Tool · Permission System · Skill Pack** + **零感知引导(三步向导 · 隐式权限学习 · Agent 一句话改规则)**。
Python 环境就是用户机器上已经有的(或我们 setup script 装好)。

---

## 1. 设计要点

### 1.1 权限系统(对标 Claude Code `settings.json`)

**配置文件:** `~/.allhands/permissions.json` · 跟 Claude Code 完全同构,允许用户直接搬规则过来

```json
{
  "permissions": {
    "default_mode": "ask",
    "allow": [
      "local.read",
      "local.list_dir",
      "local.glob",
      "local.grep",
      "local.bash(git status)",
      "local.bash(git diff:*)",
      "local.bash(ls:*)",
      "local.bash(uv run pytest:*)"
    ],
    "ask": [
      "local.write",
      "local.edit",
      "local.bash(npm install:*)"
    ],
    "deny": [
      "local.bash(rm -rf /*)",
      "local.bash(curl:*|sh)",
      "local.bash(sudo:*)"
    ]
  },
  "workspace": {
    "default_cwd": "~/allhands-workspace",
    "allowed_roots": ["~/allhands-workspace", "~/Documents/work"]
  },
  "sandbox": {
    "mode": "off",                  // off | light | strict
    "deny_network": false
  }
}
```

**规则语法:**

- `tool_name` —— 整个 tool 三态
- `tool_name(arg_pattern)` —— 按入参匹配(glob 风格 · `:*` 表示前缀)
- 同一 tool 有多条规则 → **deny > allow > ask** 优先级
- 找不到匹配 → 用 `default_mode`

**层级:**

1. `~/.allhands/permissions.json` —— 用户全局
2. `<workspace>/.allhands/permissions.json` —— 项目级(覆盖全局,只针对该 workspace)
3. 进程内 in-memory override —— 用户在 UI 临时改,不落盘的话只本会话生效

**运行时:** ConfirmationGate(已有)拿 tool_call → `PermissionResolver.decide(tool_id, args)` → `Allow / Deferred(ask) / Deny`,行为复用现有 DeferredSignal 链路(ADR 0018)。

### 1.2 Local Executor Tools

8 个 tool · 全部 backend tool · 在宿主进程跑(走 `asyncio.subprocess` 或纯 Python):

| Tool ID | scope | 说明 | 对标 Claude Code |
|---|---|---|---|
| `local.bash` | IRREVERSIBLE | 跑 shell 命令 · 流式 stdout · 默认 60s timeout | Bash |
| `local.read` | READ | 读文件 · 支持 offset/limit | Read |
| `local.write` | WRITE | 创建 / 全量重写文件 | Write |
| `local.edit` | WRITE | 字符串替换(精确匹配 · 唯一性检查) | Edit |
| `local.list_dir` | READ | 列目录 | (LS) |
| `local.glob` | READ | glob 匹配文件路径 | Glob |
| `local.grep` | READ | ripgrep 包装 | Grep |
| `local.run_python` | IRREVERSIBLE | 跑一段 Python 代码(在 cwd 下) · 复用 `local.bash` 调 python -c / 临时文件 | (常用模式) |

**cwd 守护:**

- 每个 tool 入参可带 `cwd?` · 默认走 `permissions.workspace.default_cwd`
- `cwd` 必须是 `allowed_roots` 内的子路径 · 否则 Deny(规则系统外的硬约束 · 防止误配)
- `local.read / write / edit / glob / grep` 的 path 同样必须落在 `allowed_roots` 内

**沙箱叠加(可选 · 默认 off):**

- `mode: off` —— 直接跑(Claude Code 默认)
- `mode: light` —— macOS `sandbox-exec` profile / Linux `bwrap --bind <cwd> <cwd> --ro-bind / / --dev-bind /dev /dev`,**只限文件写域**
- `mode: strict` —— 加 `--unshare-net`(禁网) + 限 syscall

### 1.3 Skill 集合(完成场景的"知识载体")

复用现有 SKILL 体系(CLAUDE.md §3.4 · ADR 0015)· 三段式 lazy-load · 全部进 `backend/src/allhands/skills/builtin/`:

| Skill ID | 触发场景 | descriptor(≤50 字符) | body 引导 agent 用 |
|---|---|---|---|
| `excel-ops` | 操作 xlsx 数据 / 核对 | "读写 Excel · openpyxl + pandas 数据核对" | `local.read` 探查 → `local.run_python` 用 openpyxl/pandas |
| `file-organize` | 整理目录结构 | "整理目录 · 按规则归类移动重命名" | `local.list_dir` + `local.glob` 探查 → `local.bash mv/mkdir` |
| `cleanup-junk` | 清理无用文件 | "清理临时/缓存/重复文件 · 先列表后确认" | `local.glob` 找 `**/__pycache__/` `**/.DS_Store` 等 → 列表给用户确认 → `local.bash rm` |
| `code-edit` | 改代码 / 跑测试 | "代码编辑 + 测试 · 小步迭代" | `local.grep/read` 定位 → `local.edit` 改 → `local.bash` 跑测试 |
| `pdf-extract` | PDF 抽文本 | "PDF 文本/表格抽取 · pypdf + pdfplumber" | `local.run_python` 跑 pypdf |

每个 Skill 一个目录(`<id>/SKILL.yaml` + `body.md` + `references/`),完全按 ADR 0015 已经实现的格式。**新增 Skill = 加目录,零代码改动**。

### 1.4 Python 执行环境

**不做容器 · 不做虚拟环境托管。** 三种姿势用户三选一(文档说明):

1. **系统 Python(最简)** —— 用户在自己机器装好 `pip install pandas openpyxl pypdf python-docx pdfplumber` ;agent 直接用
2. **uv venv(推荐)** —— 我们 setup script 里 `uv venv ~/.allhands/venv` + 装一份"标准库",workspace cwd 下自动激活;`local.run_python` 调用 `~/.allhands/venv/bin/python`
3. **conda / pyenv** —— 用户自管,在 `permissions.workspace.python_path` 里指定

**setup 脚本** (`scripts/setup-local-env.sh`):
```bash
#!/usr/bin/env bash
uv venv ~/.allhands/venv --python 3.12
~/.allhands/venv/bin/pip install \
  pandas openpyxl xlsxwriter \
  pypdf pdfplumber python-docx \
  numpy requests httpx beautifulsoup4 lxml pillow
echo "Done. allhands Python at ~/.allhands/venv"
```

### 1.5 无感引导(零配置启动)

> **设计目标:用户首次启动不需要懂"权限规则",直接对话就能干活。所有引导都自然嵌在交互里。**

**首次启动 3 个动作(向导,跳过即用默认):**

```
第 1 步:选个工作目录(可拖拽 / 输入路径)        ← 默认 ~/allhands-workspace,不动也行
第 2 步:选个权限策略 profile                     ← 默认 balanced(详见下表)
第 3 步:跑 setup-local-env.sh(按钮一键)        ← 装 Python 标准库
```

**3 个内置 profile(选一个 = 一份 permissions.json 模板):**

| Profile | 适合 | default_mode | 关键差异 |
|---|---|---|---|
| `trusted` | 自己机器 · 高度信任 agent | `allow` | 只 deny 高危(rm -rf · sudo · curl|sh)· 其余全过 |
| **`balanced`(默认)** | 大部分用户 · 平衡 | `ask` | READ 默认 allow · WRITE 默认 ask · 高危 deny |
| `paranoid` | 给"敏感目录"用 · 多重保险 | `ask` | 全部 ask(连 read 都问)· 沙箱 mode=light |

**进入主界面后的引导(隐式 · 不打断):**

- **首次让 agent 干活时:** 第一次触发 confirmation,弹窗里多 3 个按钮 —— `允许这一次` / **`总是允许这种(local.bash git status)`** / `总是允许这个 tool(local.bash)` · 用户点"总是" = 自动写一条 allow 规则
- **同类操作弹第 2 次时:** 提示条 "这是第 2 次问 X,要不要免问?" + 一键添加 allow
- **设置页右上角始终有 Pill:** "本月被弹了 N 次确认 · 看建议" → 点开列出"高频弹问"建议批量加 allow

**引导文案落点:** Welcome 弹窗 / Confirmation 弹窗 / Settings 页顶部 Hint 条 · 3 个位置就能让用户不读文档跑通。

### 1.6 Agent 一句话配权限(Meta Tool 早于 UI 提供)

> **设计目标:不用 UI 就能改权限。用户对话一句"以后 git push 直接放行",Lead Agent 调 Meta Tool 改 permissions.json,即时生效。**

**3 个 Meta Tool(scope=WRITE · 改完弹一次确认):**

| Tool ID | 入参 | 说明 |
|---|---|---|
| `allhands.meta.permission_grant` | `pattern, mode (allow/ask/deny), scope (global/workspace/session), remember=true` | 加 / 改一条规则 |
| `allhands.meta.permission_revoke` | `pattern` | 删除匹配规则 |
| `allhands.meta.permission_test` | `tool_id, args?` | 给 Lead Agent 自检"这条命令会被怎么处理" |

**典型对话脚本(用户感受):**

```
用户:以后让你跑 git 系列命令,不用每次问我了
Lead:好的,我准备给 local.bash(git:*) 加一条 allow 规则
       (作用域:全局 · 永久生效)
       要执行吗?  [允许]  [拒绝]
用户:允许
Lead:✓ 已添加。后续 git status / git diff / git push 等不再确认
```

```
用户:刚才那个删除文件的操作,以后这个目录都别问了
Lead:理解。我把 local.bash(rm:*) 在 ~/Documents/work 这个 workspace 内
       改成 allow,其他目录保持 ask。
       要执行吗?
```

**ConfirmationGate 增强(让"总是允许"和 Meta Tool 走同一条路):**

- 用户在 confirmation 弹窗点"总是允许这种" → UI 实际上调 `permission_grant` API · 跟 agent 走同一通道
- 这样保证:UI 改的、agent 改的、用户手编 JSON 改的,**永远是一份规则**(单一 SoT)

### 1.7 可视化权限页

`web/app/settings/permissions/page.tsx`:

- **三栏:** Allow / Ask / Deny · 每栏一组规则卡片 · 直接拖动改归属
- **规则卡片:** tool 名 + 参数 pattern + 命中次数(过去 7 天)
- **测试器:** 上面有个输入框,输 `local.bash(git push origin main)` 实时显示会被哪条规则匹配 · 三态结果
- **沙箱开关:** mode(off/light/strict)+ deny_network 切换 · 改动立刻 hot-reload
- **导入/导出:** 直接给 JSON · 也给"从 Claude Code settings.json 导入"按钮(把 `Bash(...)` 这种自动映射成 `local.bash(...)`)

走 REST(Tool First 双入口已经允许 settings 走 REST · 见 CLAUDE.md §3.1 例外列表)· 同时有 Meta Tool `allhands.meta.update_permissions` 让 Lead Agent 通过对话也能改。

---

## 2. 分层落点(import 契约)

```
backend/src/allhands/
├── core/
│   └── domain/permissions.py          # PermissionRule / PermissionMode / Decision (纯 pydantic)
├── persistence/
│   └── stores/permission_store.py     # JSON 文件读写 · 文件系统 SoT(不入 SQL)
├── execution/
│   ├── permission_resolver.py         # 规则匹配引擎
│   └── tools/local/
│       ├── bash.py
│       ├── read.py · write.py · edit.py
│       ├── list_dir.py · glob.py · grep.py
│       └── run_python.py
├── execution/sandbox/                 # 可选 light/strict 实现(p4)
│   ├── runner.py                      # SandboxRunner ABC
│   ├── passthrough.py                 # mode=off
│   ├── macos_sandbox_exec.py          # mode=light/strict on darwin
│   └── linux_bwrap.py                 # mode=light/strict on linux
├── services/
│   └── permissions_service.py         # 加载 / 保存 / 命中统计
└── api/routers/
    └── permissions.py                 # GET / PUT / 测试 endpoint

backend/src/allhands/skills/builtin/
├── excel-ops/SKILL.yaml + body.md
├── file-organize/SKILL.yaml + body.md
├── cleanup-junk/SKILL.yaml + body.md
├── code-edit/SKILL.yaml + body.md
└── pdf-extract/SKILL.yaml + body.md

web/
├── app/settings/permissions/page.tsx
├── components/permissions/
│   ├── RuleCard.tsx
│   ├── RuleTester.tsx
│   ├── SandboxModeSwitch.tsx
│   └── ImportFromClaudeCode.tsx
└── lib/api/permissions.ts
```

**契约自检:**

- ✅ `core/permissions.py` 纯 pydantic
- ✅ `permission_store.py` 在 `persistence/`(虽然不是 SQL · 文件就是 SoT)
- ✅ `tools/local/*` 在 `execution/`,通过 `PermissionResolver` 拿决策 · 不直接读 JSON
- ✅ Tool First:CRUD permissions 既有 REST(REST-only 例外:settings 类) 也有 Meta Tool `allhands.meta.update_permissions`(便于对话调整)
- ✅ Pure-Function Loop:工具结果走 `InternalEvent` · ConfirmationGate 走已有 DeferredSignal · 不在 AgentLoop 里加状态

---

## 3. 分阶段实现(每阶段独立可合 main)

> 总工作量预估 ~ 6-8 个工作日。每 phase 完成自跑 lint / mypy / pytest / lint-imports / pnpm typecheck / build,绿了直接合 main。

### Phase 1 · Local Executor + 权限引擎 + Agent 一句话配置(3-4 天)

**目标:** Lead Agent 通过 `local.*` 跑命令 · 每次写操作走 ConfirmationGate · **同时**让 Lead Agent 通过 Meta Tool 一句话改权限(无 UI 也能用)

- `core/domain/permissions.py`(PermissionRule / Mode / Decision · 全部 pydantic)
- `persistence/stores/permission_store.py`(JSON 读写 · `~/.allhands/permissions.json` + 项目级覆盖 · 文件 mtime 监听 hot-reload)
- `execution/permission_resolver.py`(deny > allow > ask · 入参 glob 匹配)
- `execution/tools/local/{bash,read,write,edit,list_dir,glob,grep,run_python}.py`(8 个 tool)
- `execution/tools/meta/permissions.py`(3 个 meta tool:`permission_grant` / `permission_revoke` / `permission_test`)
- `discover_builtin_tools()` 注册 8 + 3 个 tool
- 3 个 profile 模板:`backend/src/allhands/templates/permissions_profile_{trusted,balanced,paranoid}.json`(首次启动按用户选择复制)
- `tests/unit/permissions/test_resolver.py`(规则优先级 / pattern matching / 边界)
- `tests/unit/tools/test_local_*.py`(每个 tool 单元 · 用 tmp_path)
- `tests/unit/tools/meta/test_permission_grant.py`(meta tool 改文件 · resolver 立即看到)
- `tests/integration/test_local_executor_flow.py`(agent → bash → confirmation → 执行)
- `tests/integration/test_one_shot_permission_dialog.py`(模拟"以后 git push 直接放行"对话 → 验证 JSON 文件被改对)

**Definition of Done:**
- 通过对话让员工 "ls 我 home 目录"成功 · "rm 任意文件"会弹确认
- **对话 "以后 git push 直接放行" → Lead Agent 调 `permission_grant` 弹一次确认 → 改完 `~/.allhands/permissions.json` → 下次 git push 不再问**(关键:无 UI 也能完成全流程)

### Phase 2 · Skill 集 + 真实场景演示(1-2 天)

**目标:** Excel / 文件整理 / 清理 / 代码编辑 / PDF 五个内置 skill 跑通

- 5 个 skill 目录 · 每个含 `SKILL.yaml`(descriptor) + `body.md`(激活时注入) + 必要的 `references/`
- skill body 里写清楚:**先 read/list 探查 → 给用户列出计划 → 等确认 → 再 write/exec** 这种谨慎模式
- `scripts/setup-local-env.sh` 装 Python 标准库
- 集成测试 fixtures:一个示例 xlsx + 一个杂乱目录 · 验证 5 个 skill 能各完成一个最小任务
- 文档:`product/scenarios/local-tasks.md` 写每个场景的对话脚本(给用户演示)

**DoD:** 用户上传一个 xlsx,对话"对账两列差异"能跑出来。

### Phase 3 · 无感引导 + 可视化权限页(2 天)

**目标:** 首次启动有向导 · Confirmation 弹窗带"总是允许"快捷键 · 设置页能 CRUD 规则

**首次启动向导(`web/app/welcome/page.tsx`):**
- 3 步:工作目录 / Profile / setup 脚本(均可跳过 · 默认 balanced)
- 跳过也能直接对话 · profile 自动按 balanced 落盘

**Confirmation 弹窗增强(改现有组件):**
- 多 3 个按钮:`允许这一次` · **`总是允许这种 (xxx)`** · `总是允许这个 tool`
- 后两个 → 调 `permission_grant` API · 写规则 + 立即放行本次

**Settings 页 (`web/app/settings/permissions/page.tsx`):**
- 三栏(Allow / Ask / Deny)+ 拖拽改归属
- `RuleCard` / `RuleTester` / `SandboxModeSwitch` / `ImportFromClaudeCode` / `ProfileSwitcher`
- 顶部 Hint 条:"本月被弹了 N 次确认 · 看建议" · 点开列出高频弹问 · 一键批量 allow
- API routes:`GET/PUT /api/settings/permissions` + `POST /api/settings/permissions/test` + `GET /api/settings/permissions/suggestions`
- 命中统计:`PermissionStore` 简单 counter(进程内 + 周期持久化)
- e2e:playwright 改一条规则 → 命中变化 · 跑 confirmation 流点"总是允许" → 规则文件被加
- 设计:走 Brand Blue token · 不写裸色

**DoD:**
- 新用户从启动到跑通第一个 Excel 任务 · 全程不用打开 Settings 页
- 用户在 Confirmation 点"总是允许 (local.bash git status)" → ~/.allhands/permissions.json allow 数组多一条
- Settings 页拖一条规则从 ask 到 deny → 立即生效

### Phase 4 · 轻沙箱(可选 · 1 天)

**目标:** 给愿意要二层防御的用户提供 macOS / Linux 进程级沙箱

- `SandboxRunner` ABC + 3 个实现(passthrough / macos / linux)
- `local.bash` / `local.run_python` 启动时按 `permissions.sandbox.mode` 决定包不包 wrapper
- macos profile: 写域限 cwd · 网络按 deny_network 切
- linux: bwrap 包装 · 同上
- 集成测试:strict 模式下 `bash 'echo > /etc/passwd'` 必失败

**DoD:** mode=strict 时跑 `curl example.com` 被拒,`ls cwd` 正常。

### Phase 5(后续) · L01 Tool First 闭环回归

- L01 回归:REST 路由 ↔ Meta Tool 配对检查(`test_learnings.py::TestL01ToolFirstBoundary`)
- ADR `00NN-local-execution-foundation.md` 落档(取代 sandbox-foundation 的命名)
- 文档化:CLAUDE.md §3.X 加一节 "本地执行原则 · 规则即配置 · UI/CLI/Agent 三入口同 SoT"
- 注:meta tool 已在 Phase 1 落地,这里只做 L01 配对回归 + 文档收尾

---

## 4. 关键决策(请你拍板,否则我按默认走 · 10 项)

| # | 问题 | 默认选项 |
|---|------|---------|
| D1 | 权限文件位置 | `~/.allhands/permissions.json` + workspace 级 `<cwd>/.allhands/permissions.json`(同 Claude Code) |
| D2 | 默认 default_mode | `ask`(保守 · 第一次跑啥都问)· 用户可改 `allow` 走"信任全部"风格 |
| D3 | 沙箱默认 | `off`(对齐 Claude Code · light/strict 后续按需)|
| D4 | Python 环境 | 走 setup script 装 `~/.allhands/venv`(避免污染用户系统 Python)|
| D5 | `allowed_roots` 默认 | 仅 `~/allhands-workspace`(强制用户首次 setup 时确认要不要加 `~/Documents` 等)|
| D6 | 工作目录概念 | 不引入"workspace 实体"· cwd 由 conversation/employee 配置直接给(轻量 · 同 Claude Code)|
| D7 | 是否兼容导入 Claude Code settings.json | 是 · `Bash(git:*)` → `local.bash(git:*)` 自动映射 |
| D8 | 默认 profile | `balanced`(READ allow / WRITE ask / 高危 deny)· 首次启动向导可改 |
| D9 | 向导是否强制 | **不强制** · 全部一键 Next · 不点也能直接对话(默认 balanced + ~/allhands-workspace + setup 脚本异步后台跑) |
| D10 | "总是允许"是写到全局还是当前 workspace | 默认 workspace 级(精确)· 弹窗下面有 checkbox "扩到全局" · 一键提升 |

如果都按默认 → 我可以直接进 Phase 1。

---

## 5. 风险 & 已知约束

| # | 风险 | 应对 |
|---|------|------|
| R1 | 用户机器没装 ripgrep / fd → `local.grep/glob` 失败 | setup script 检测 + 降级到 Python 实现(慢但能跑) |
| R2 | macOS Gatekeeper 拦 `sandbox-exec` 调用 | Phase 4 测试覆盖 · 文档给开权限步骤 |
| R3 | `local.bash` 长输出撑爆 token | 截断 + 落盘 · 给 agent 返回"前 N 行 + 提示去 `local.read` 全文" |
| R4 | 用户对话时上传大文件 | `local.write` 的 confirmation payload 显示文件大小 · 超 100MB 警告 |
| R5 | Permission 规则越来越多用户管不过来 | UI 命中统计 + "30 天未命中"标灰提示清理 |
| R6 | Skill body 引导不够 → agent 还是用 raw bash 干 Excel | 在 system prompt 强调 "看到 .xlsx → 先激活 excel-ops skill" · 加测试断言 |

---

## 6. 测试策略

- **unit**:resolver 规则匹配 · 每个 local tool 入参验证 + cwd 校验 · permission_store 文件读写
- **integration**:agent 调 local.bash 走完整 confirmation 链路 · 5 个 skill 各跑一个最小任务 · permissions hot-reload
- **e2e**(playwright):权限页改规则 → 后端 GET 验证 · 沙箱开关 → reload 后状态保持
- **import-linter**:`core/` 不 import asyncio.subprocess · `tools/local/` 不绕过 PermissionResolver
- **回归**:L01 Tool First(Phase 5)· ADR 0018 no langgraph

---

## 7. 不做的事(明确划线)

- ❌ Docker / 容器 / workspace 实体抽象(对齐 Claude Code · 你的场景不要)
- ❌ 多租户隔离(单用户自部署)
- ❌ 远程 worker / 任务队列(本地同步执行 · 长任务靠 agent 自己 spawn subagent)
- ❌ 自己实现一个 sandbox-exec 等价物(用系统现成的)
- ❌ pip 包管理 UI(让用户自己跑 setup script · 不重复造轮子)
- ❌ 文件版本控制(用户工作目录大概率本来就是 git 仓库 · 让 agent 用 `local.bash git ...`)

---

## 8. 落地后用户视角

### 8.1 零配置上手(典型新用户)

```
1. 安装 allhands · 首次启动 3 步向导(全部一键 Next 即可)
   → 默认工作目录 ~/allhands-workspace · 默认 balanced profile
   → 后台自动跑 setup-local-env.sh 装 Python 标准库
2. 创建员工 · 默认带 local.* + 5 个 builtin skill(零额外配置)
3. 对话:"把 ~/Documents/work/sales.xlsx 里两个 sheet 的客户编号差异列出来"
   → agent 激活 excel-ops skill → local.read 探查 → local.run_python 跑 openpyxl
   → 弹 confirmation 三个按钮:[允许这次] [总是允许这种] [总是允许 local.run_python]
   → 用户点"总是允许这种" → 返回差异列表 + 后台静默写一条 allow 规则
4. 同类对话再发一次 → 不再弹 · 直接出结果
```

**全程没打开过 Settings 页。**

### 8.2 用对话调权限(进阶 / 偷懒党)

```
用户:刚才 git status 弹了三次了,以后所有 git 命令都别问
Lead:好的,我加一条规则:local.bash(git:*) → allow(全局生效)
       要执行吗?  [允许]  [拒绝]
用户:允许
Lead:✓ 已添加 · 后续 git 命令直接放行
```

```
用户:~/Documents/secret/ 这个目录给我严管,任何写都问
Lead:好,我在 workspace 级覆盖加 ~/Documents/secret/.allhands/permissions.json
       把 local.write / edit / bash(rm:*) 全部设为 ask
       执行吗?
```

### 8.3 高阶 / 直接编 JSON

`~/.allhands/permissions.json` 是单一 SoT · 用户可以直接 vim 编辑 · 文件 mtime 监听自动 hot-reload。**UI 改 / Agent 改 / 手编都改同一份文件**(三入口语义等价)。

---

跟 Claude Code 的体感几乎一样,只是:
- 装在 web 里(不是 CLI)
- agent 是"团队员工"(不是单 instance)
- **比 Claude Code 多一层:可以让 agent 一句话改权限**(Claude Code 现在也只能编 settings.json)

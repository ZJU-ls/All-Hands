# allhands 本地执行能力 · 实现方案

> 路线 = **完全对齐 Claude Code**:本地宿主直接执行 · 权限文件 + 可视化权限页 + Skill 驱动 Python 完成业务场景。
> 取代上一版 [REPORT.md](REPORT.md) 中的容器沙箱主线(那是多租户场景,现不需要)。
> 2026-04-25 · branch: research/sandbox

---

## 0. 一图看懂

```
        ┌──────────────────────────────────────────────┐
        │                  Lead Agent                  │
        │  (拿到一个任务 · 决定调哪些 tool / 激活哪个 skill) │
        └─────────────┬─────────────────┬──────────────┘
                      │                 │
          activate    │                 │ call
                      ▼                 ▼
        ┌────────────────────┐  ┌──────────────────────┐
        │ Skill (能力 + 知识) │  │  Local Executor Tool │
        │  excel-ops         │  │  local.bash          │
        │  file-organize     │  │  local.read/write/edit│
        │  cleanup-junk      │  │  local.glob/grep     │
        │  code-edit         │  │  local.run_python    │
        └────────────────────┘  └─────────┬────────────┘
                                          │
                              PermissionGate(读规则)
                                          │
                            allow / ask(走 Confirmation)/ deny
                                          │
                                          ▼
                         ┌────────────────────────────────┐
                         │   宿主进程(用户机器 · cwd 限定) │
                         │   Python · git · ripgrep · ...  │
                         │   (可选)sandbox-exec/Landlock   │
                         └────────────────────────────────┘
```

核心三件套:**Local Tool · Permission System · Skill Pack**。Python 环境就是用户机器上已经有的(或我们安装时装好)。

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

### 1.5 可视化权限页

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

### Phase 1 · Local Executor + 权限引擎(2-3 天)

**目标:** Lead Agent 通过 `local.*` 跑命令 · 每次写操作走 ConfirmationGate · 用静态规则(暂无 UI)

- `core/domain/permissions.py`(PermissionRule / Mode / Decision · 全部 pydantic)
- `persistence/stores/permission_store.py`(JSON 读写 · `~/.allhands/permissions.json` + 项目级覆盖)
- `execution/permission_resolver.py`(deny > allow > ask · 入参 glob 匹配)
- `execution/tools/local/{bash,read,write,edit,list_dir,glob,grep,run_python}.py`(8 个 tool)
- `discover_builtin_tools()` 注册 8 个 tool
- `tests/unit/permissions/test_resolver.py`(规则优先级 / pattern matching / 边界)
- `tests/unit/tools/test_local_*.py`(每个 tool 单元 · 用 tmp_path)
- `tests/integration/test_local_executor_flow.py`(agent → bash → confirmation → 执行)
- 默认 `permissions.json` 模板:`backend/src/allhands/templates/default_permissions.json`(首次启动复制到 `~/.allhands/`)

**Definition of Done:** 起 backend + UI · 通过对话让员工 "ls 我 home 目录"成功 · "rm 任意文件"会弹确认。

### Phase 2 · Skill 集 + 真实场景演示(1-2 天)

**目标:** Excel / 文件整理 / 清理 / 代码编辑 / PDF 五个内置 skill 跑通

- 5 个 skill 目录 · 每个含 `SKILL.yaml`(descriptor) + `body.md`(激活时注入) + 必要的 `references/`
- skill body 里写清楚:**先 read/list 探查 → 给用户列出计划 → 等确认 → 再 write/exec** 这种谨慎模式
- `scripts/setup-local-env.sh` 装 Python 标准库
- 集成测试 fixtures:一个示例 xlsx + 一个杂乱目录 · 验证 5 个 skill 能各完成一个最小任务
- 文档:`product/scenarios/local-tasks.md` 写每个场景的对话脚本(给用户演示)

**DoD:** 用户上传一个 xlsx,对话"对账两列差异"能跑出来。

### Phase 3 · 可视化权限页(1-2 天)

**目标:** 在 UI 上 CRUD 规则 · 测试器 · 沙箱开关

- `web/app/settings/permissions/page.tsx`
- `RuleCard` / `RuleTester` / `SandboxModeSwitch` / `ImportFromClaudeCode`
- API routes(已在 Phase 1 占位):`GET/PUT /api/settings/permissions` + `POST /api/settings/permissions/test`
- 命中统计:`PermissionStore` 简单 counter(进程内 + 周期持久化)
- e2e:playwright 改一条规则 → 命中变化
- 设计:走 Brand Blue token · 不写裸色

**DoD:** 用户能在页面把"local.bash(rm:*)"从 ask 移到 deny · 立即生效。

### Phase 4 · 轻沙箱(可选 · 1 天)

**目标:** 给愿意要二层防御的用户提供 macOS / Linux 进程级沙箱

- `SandboxRunner` ABC + 3 个实现(passthrough / macos / linux)
- `local.bash` / `local.run_python` 启动时按 `permissions.sandbox.mode` 决定包不包 wrapper
- macos profile: 写域限 cwd · 网络按 deny_network 切
- linux: bwrap 包装 · 同上
- 集成测试:strict 模式下 `bash 'echo > /etc/passwd'` 必失败

**DoD:** mode=strict 时跑 `curl example.com` 被拒,`ls cwd` 正常。

### Phase 5(后续 · 不在本批) · Meta Tool + 完整 Tool First 闭环

- `allhands.meta.update_permissions` / `read_permissions` / `test_permission_rule` 三个 meta tool
- 让 Lead Agent 在对话里说 "把 git push 加到 ask 里" 也能完成
- L01 回归:REST 路由 ↔ Meta Tool 配对检查(`test_learnings.py::TestL01ToolFirstBoundary`)

---

## 4. 关键决策(请你拍板,否则我按括号里默认走)

| # | 问题 | 默认选项 |
|---|------|---------|
| D1 | 权限文件位置 | `~/.allhands/permissions.json` + workspace 级 `<cwd>/.allhands/permissions.json`(同 Claude Code) |
| D2 | 默认 default_mode | `ask`(保守 · 第一次跑啥都问)· 用户可改 `allow` 走"信任全部"风格 |
| D3 | 沙箱默认 | `off`(对齐 Claude Code · light/strict 后续按需)|
| D4 | Python 环境 | 走 setup script 装 `~/.allhands/venv`(避免污染用户系统 Python)|
| D5 | `allowed_roots` 默认 | 仅 `~/allhands-workspace`(强制用户首次 setup 时确认要不要加 `~/Documents` 等)|
| D6 | 工作目录概念 | 不引入"workspace 实体"· cwd 由 conversation/employee 配置直接给(轻量 · 同 Claude Code)|
| D7 | 是否兼容导入 Claude Code settings.json | 是 · `Bash(git:*)` → `local.bash(git:*)` 自动映射 |

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

```
1. 安装 allhands · 首次启动弹"配置工作目录"
   → 用户选 ~/Documents/work · 自动写入 permissions.json
2. 跑 scripts/setup-local-env.sh · 装 Python 标准库
3. 创建一个员工(默认带 local.* + 5 个 builtin skill)
4. 对话:"把 ~/Documents/work/sales.xlsx 里两个 sheet 的客户编号差异列出来"
   → agent 激活 excel-ops skill
   → 调 local.read 探查文件
   → 调 local.run_python 跑 openpyxl 读两个 sheet
   → 弹 confirmation:"将运行 Python · 只读模式"  → 用户 allow
   → 返回差异列表
5. 用户在 settings/permissions 把 "local.run_python(只读)" 改成 allow
   → 下次同类操作不再弹
```

跟 Claude Code 的体感几乎一样,只是装在 web 里 + agent 是"团队员工"而不是 CLI。

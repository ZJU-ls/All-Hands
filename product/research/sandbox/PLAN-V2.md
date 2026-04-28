# allhands 本地全知全能 · 实现方案 V2

> **路线 V2:** 不止"能跑命令" · 而是 **"在用户电脑上无所不能"** —— OS 原生自动化 + Computer Use 视觉控制 + MCP 生态融入 + 长期记忆 + Proactive 触发 + Skill 自合成 + 6 tier 工具栈。
> 取代 [PLAN.md](PLAN.md) v1 · 经 10 轮调研迭代得到。每轮做了什么见 [ITERATIONS.md](ITERATIONS.md) / [ITERATIONS.html](http://127.0.0.1:8765/ITERATIONS.html)。
> 2026-04-26 · branch: research/sandbox

---

## 0 · TL;DR

**目标:** 让 allhands 在用户的 Mac/Linux/Win 上,做到比 Claude Code / Cline / Goose 都强的"日常超能力" —— **同一个员工**能写代码、改 Excel、清磁盘、操作浏览器、自动化 macOS、查日历、收邮件、定时跑任务、把成功流程沉淀成新 skill。

**比 v1 多了什么:**

| 维度 | v1 | V2 | 行业对标 |
|---|---|---|---|
| Tool 数 | 8 个 local.* | **40+**(分 6 tier) | OpenHands 30+ · Cline 15+ · Goose 70+ ext |
| OS 集成 | 仅 shell | macOS Shortcuts/AppleScript · Win COM/PS · Linux D-Bus | Goose / 自有 |
| GUI 控制 | 无 | Computer Use API + Playwright · 视觉操作任意 app | Claude Code(2026.3 GA) · Goose |
| MCP | 无 | **作为 host** · 集成 registry · 一键装 server | Goose 70+ ext · 3000 servers |
| 记忆 | 无 | 三层(core/archival/recall · Mem0 风格)+ Spotlight 作即时索引 | Mem0 · Letta |
| Proactive | 无 | 文件 watcher · cron · 系统通知 · 长驻 daemon | OpenClaw / Codex /loop |
| Skill 合成 | 5 个内置 | 内置 + **agent 把成功会话沉淀成新 skill**(skill-creator pattern) | anthropics/skill-creator |
| Sandbox 默认 | off | **light**(参考 OpenAI Codex `workspace-write` 默认隔离)· 可关 | Codex 默认 on · Claude Code 默认 off |
| Permission | JSON 三态 | 三态 + **per-category 自动批** + **YOLO mode** + **trusted/untrusted workspace** | Cline auto-approve · Codex trust |
| 工作量 | 6-8 天 | **15-18 天**(含 OS 自动化 + Computer Use + Proactive · 仍可分阶段) | — |

**仍然不变(v1 的对的部分):**

- 不做容器(单用户自部署)
- Tool First / Pure-Function Loop / Layer Isolation 三大架构原则
- Permission file 是单一 SoT · UI/Confirmation/Agent 三入口同步
- 完全可逐 phase 合 main · 每 phase 独立可用

**TL;DR 一图:**

```
              用户 ←─── 自然语言 ───→ Lead Agent
                                           │
        ┌──────────┬──────────┬───────────┼──────────┬──────────┬──────────┐
   activate     call         call         call      call       call       hook
        ▼          ▼            ▼            ▼          ▼          ▼          ▼
     Skill    Tier 0:      Tier 1:      Tier 2:    Tier 3:    Tier 4:   Memory
   (能力知识) Native CLI    Local       OS         GUI        MCP      (3 tier)
              (mdfind/git/ Script      Automation Computer   Server    core/arch
               curl/rg)    (py/node)   (osascript/Use API   (3000+)   /recall
                                       PS/dbus)   Playwright
        │          │            │            │          │          │          │
        └──────────┴────────────┴── PermissionGate ─────┴──────────┘          │
                                       │                                       │
                          allow / ask / deny / yolo / trusted-ws               │
                                       │                                       ▼
                                       ▼                              Mem0-style store
                                  宿主进程(可选 sandbox-exec/Landlock)+ Spotlight 作即时索引
                                       │
                                       ▼
        ┌──────────────────────────────────────────┐
        │  Proactive 层(独立 process · 触发对话)   │
        │  file watcher · cron · webhook · 系统通知│
        └──────────────────────────────────────────┘
                                       │
                                       ▼
                            agent 跑出"成功流程"
                                       │
                                       ▼
                          Skill Self-Synthesizer 生成新 SKILL.md
                                       │
                                       ▼
                            进 ~/.allhands/skills/learned/
                                       │
                                       ▼
                              下次类似任务 zero-shot 用上
```

---

## 1 · 行业对标(2026.04 状态)

> 为什么这一节重要:**抄好的、避坑的、抓 gap**。10 轮迭代里第 1 轮花了大量时间在这上面。

### 1.1 同行 6 个工具速览

| 工具 | 形态 | star | 长处 | 缺位(我们要做对) |
|---|---|---|---|---|
| **OpenHands** (重名提醒!) | 全平台 agent · Docker runtime + 本地 workspace | 68k | Plugin 系统 · Workspace 抽象成熟 · ActionExecutor 模型 | 重 Docker · 普通用户装不动 |
| **Cline** | VS Code 插件 · approve every step | 58k | 细粒度 auto-approve(读/写/exec/browser/mcp 各自独立) · YOLO mode · `.clinerules` | 受限 IDE · 不能脱离 VS Code |
| **Aider** | CLI · 自动 git commit | 41k | git 强绑定 · 每次改动有 trace | 只做代码 · 不做 office/桌面 |
| **Goose** (Block / 已捐 Linux Foundation) | Rust + Electron 桌面 app + CLI | 32k | **70+ 内置 ext · 3000+ MCP server 接入 · 桌面 app 能在对话里渲染交互 UI** | 需要装客户端 · 不是 web |
| **Continue** | VS Code · BYOM | 31k | 配置 YAML 设计漂亮 · profiles 切换 | 偏代码补全 · 不是 agent |
| **Claude Code** | CLI · `sandbox-exec`/Landlock + permission | (闭源) | settings.json 三态 permission · /loop 自调度 · skill 体系 · Computer Use(2026.3 GA) | 单用户 CLI · 没有 web/多员工 |

### 1.2 关键启示

1. **Goose 是最像我们想做的样子** —— 桌面 app + MCP 大集成 + 多端(CLI / Web / API)。我们的差异化:web 多用户协作 + Lead Agent 一句话改权限 + Tool First 哲学(Skill 不只是说明书,Tool 不只是 executor,**两层都让 agent 自己能动手扩展**)。
2. **OpenAI Codex 在 sandbox 上是行业唯一"默认开"** —— 这一点要学,把"trusted/untrusted workspace"做出来,默认 light sandbox。
3. **anthropics/skill-creator 是关键 pattern** —— "完成一个长任务后,问 agent 要不要把刚才学的封成 skill" → SKILL.md 自动生成 → 下次 zero-shot 复用。这个是 v1 完全没考虑的能力,V2 要内置。
4. **macOS `mdfind` + Spotlight 是天然 RAG** —— 125+ metadata 属性 · `-interpret` 支持自然语言。我们做"本地知识库 RAG"的成本可能为零(只要 agent 会用 mdfind)。
5. **Cline 的 per-category auto-approve** 比我们 v1 的"每条规则一弹"更人性 —— 用户开 5 个 toggle 就能定 80% 的策略,细规则只在边界场景用。
6. **OpenHands 的 Plugin 系统** 给我们一个干净的扩展点 —— 我们叫 `Capability Pack`(skill 是知识包 · capability pack 是工具包),三段加载同 skill。

---

## 2 · "全知全能"能力矩阵

> 12 个能力域 · 每个域列出 v1 覆盖率 → V2 目标 → 落点。这是 V2 整个设计的脚手架。

| # | 能力域 | v1 | V2 目标 | 落点 |
|---|------|----|--------|-----|
| **A** | 文件系统(读/写/搜) | local.read/write/edit/glob/grep | + `local.find_natural`(mdfind 包装)+ `local.diff`(三方对比)+ `local.archive`(zip/tar) | Tier 0/1 |
| **B** | 进程 / 命令执行 | local.bash | + `local.spawn_long`(后台进程 · stdout pipe 给 agent)+ `local.kill` | Tier 0 |
| **C** | 代码语义(LSP / AST) | 无 | `local.code.symbols` / `code.refs` / `code.rename` · 走 tree-sitter | Tier 1 |
| **D** | 包管理 | 通过 bash | + `local.pkg.install`(brew/apt/winget/pip/npm 统一)· `pkg.outdated` · `pkg.search` | Tier 1 |
| **E** | 网络 | 通过 bash curl | + `local.http`(httpx 包装 · 流式)· `local.dns` · `local.ping` · `local.port_scan` | Tier 1 |
| **F** | OS 自动化 | 无 | macOS:`os.osascript` · `os.shortcut.run` · `os.notification`<br>Win:`os.powershell` · `os.com_invoke`<br>Linux:`os.dbus` · `os.notify_send` | Tier 2 |
| **G** | GUI 控制 | 无 | `gui.screenshot` · `gui.click(x,y)` · `gui.type` · `gui.read_screen`(用 Anthropic Computer Use API) | Tier 3 |
| **H** | 浏览器 | 通过 bash curl | `browser.open` · `browser.navigate` · `browser.fill_form` · `browser.click` · `browser.scrape`(Playwright) | Tier 3 |
| **I** | 数据源(DB/API) | 无 | MCP host · 内置常用(postgres / sqlite / github / slack / gmail · 见 §6) | Tier 4 |
| **J** | 通信 | 无 | macOS:Mail.app via osascript · iMessage · Calendar<br>跨平台:smtp + slack/discord MCP | Tier 2/4 |
| **K** | AI 服务路由 | model_gateway 已有 | + `ai.transcribe`(whisper 本地)· `ai.image_describe`(本地 multimodal)· `ai.embed`(本地 sentence-transformers) | Tier 1 |
| **L** | 自我扩展 | 无 | `meta.create_skill`(把当前会话封 SKILL.md)· `meta.create_tool`(把脚本封 backend tool)· `meta.list_my_skills` | Meta |

**对比同行:**

| 域 | OpenHands | Cline | Goose | Claude Code | allhands V2 |
|---|:---:|:---:|:---:|:---:|:---:|
| A 文件 | ✅ | ✅ | ✅ | ✅ | ✅ + mdfind 自然语言 |
| B 进程 | ✅ | ✅ | ✅ | ✅ | ✅ + 后台 spawn |
| C 代码语义 | 部分(VSCode 插件) | LSP via VSCode | ext | ⚠️(靠 grep) | ✅ tree-sitter 内嵌 |
| D 包管理 | bash | bash | bash | bash | ✅ 统一 tool |
| E 网络 | bash | bash | bash | bash | ✅ httpx 一等公民 |
| F OS 自动化 | ❌ | ❌ | ext | ❌ | ✅ 内置三平台 |
| G GUI Control | ❌ | ❌ | ⚠️ ext | ✅(2026.3) | ✅ |
| H 浏览器 | ✅(Chromium) | ✅(headless) | ext | ❌ | ✅ |
| I 数据源 | ext | MCP | MCP 70+ | MCP | ✅ 精选 + registry |
| J 通信 | ❌ | ❌ | MCP | ❌ | ✅ macOS 原生 + MCP |
| K AI 路由 | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ✅ 多 provider |
| L 自扩展 | ❌ | ❌ | ⚠️(recipes) | ⚠️(skill-creator 手动) | ✅ 自动从会话提取 |

**结论:** F/J/L 是我们的差异化高地,A/E/I 是要做对的基本盘,G/H 是必须跟上行业的项。

---

## 3 · 核心架构 · 6 Tier 工具栈

> 灵感来自 Claude Computer Use 的"先用结构化 connector,再退到 GUI 控制"分层思想。

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Tier 0 · Native CLI Wrapper                                            │
│  最便宜 · 最快 · agent 用得最多                                          │
│  例:local.bash · local.find_natural(mdfind)· local.git · local.ripgrep │
├──────────────────────────────────────────────────────────────────────────┤
│  Tier 1 · Local Script (Python / Node)                                  │
│  跑一段代码 · 用 ~/.allhands/venv 标准库                                  │
│  例:local.run_python · local.run_node · local.code.symbols(tree-sitter) │
├──────────────────────────────────────────────────────────────────────────┤
│  Tier 2 · OS Automation (平台原生)                                       │
│  macOS:osascript / Shortcuts CLI / `defaults`                           │
│  Win:PowerShell / COM                                                   │
│  Linux:D-Bus / xdotool                                                  │
│  例:os.osascript · os.shortcut.run · os.notification · os.imsg.send     │
├──────────────────────────────────────────────────────────────────────────┤
│  Tier 3 · GUI / Computer Use                                            │
│  视觉控制任意 app · 走 Anthropic Computer Use API + Playwright           │
│  例:gui.screenshot · gui.click · gui.type · browser.fill_form          │
├──────────────────────────────────────────────────────────────────────────┤
│  Tier 4 · MCP Server                                                    │
│  作为 MCP host · 集成 registry.modelcontextprotocol.io                  │
│  例:mcp.github.* · mcp.postgres.* · mcp.slack.* · mcp.gmail.*          │
├──────────────────────────────────────────────────────────────────────────┤
│  Tier 5 · Cloud Connector(Anthropic 风格 · 优先级最高)                  │
│  当用户绑了 Google/Slack 账号,优先走结构化 API,而非 Tier 3 GUI         │
│  例:cloud.google.calendar.*  cloud.slack.*  cloud.notion.*             │
└──────────────────────────────────────────────────────────────────────────┘
```

**Lead Agent 的"工具优先级":Tier 5 → 4 → 2 → 1 → 0 → 3**

为什么 GUI 控制在最后?因为它最贵(截屏 token + 视觉延迟),且最不可靠。**只有当其他 tier 都没辙时**才退到 GUI。这个排序由 system prompt 注入到 agent。

**Skill 不在 tier 里**,它是横切的"知识 + tool 引用"包,激活后告诉 agent "这个场景下从这几个 tool 中选"。

---

## 4 · 详细 Tool 清单(40+)

每个 tool 标 `tier` / `scope`(READ/WRITE/IRREVERSIBLE)/ `requires_confirm`(走 default_mode 还是强制)。

### 4.1 Tier 0(Native CLI · 16 个)

| Tool | scope | 备注 |
|---|---|---|
| `local.bash` | IRREVERSIBLE | 通用 shell · 流式 |
| `local.read` | READ | offset/limit · ≤10MB |
| `local.write` | WRITE | 全量重写 |
| `local.edit` | WRITE | 唯一字符串替换 |
| `local.list_dir` | READ | 过滤 .git / node_modules / __pycache__ |
| `local.glob` | READ | `**/*.py` |
| `local.grep` | READ | ripgrep 包装 |
| **`local.find_natural`** | READ | mdfind 包装 · "上周改的 markdown" 等自然语言 (macOS) / locate (Linux) / Win Search (Win) |
| `local.diff` | READ | 三方对比(2 文件 · 文件 vs 远端 URL) |
| `local.archive` | WRITE | zip / tar / unzip · 显示文件清单后再问 |
| `local.delete` | IRREVERSIBLE | 永久删 · 默认走回收站(macOS osascript / Win Recycle) |
| `local.move` | WRITE | 含重命名 |
| `local.copy` | WRITE | |
| `local.git` | WRITE | 包装 git 子命令 · `status/diff/log/add/commit` 默认 ask · `push/reset` 默认 deny |
| `local.ripgrep` | READ | rg 直调(性能优于 grep) |
| `local.tree` | READ | 目录树打印 · 限深度 |

### 4.2 Tier 1(Local Script · 7 个)

| Tool | scope | 备注 |
|---|---|---|
| `local.run_python` | IRREVERSIBLE | `~/.allhands/venv` · 60s timeout · IO 截断 |
| `local.run_node` | IRREVERSIBLE | 同上 · 包用 npx |
| `local.code.symbols` | READ | tree-sitter 抽函数/类符号 |
| `local.code.refs` | READ | 找引用 |
| `local.code.rename` | WRITE | 重命名 + 全局更新引用 |
| `local.spawn_long` | IRREVERSIBLE | 后台跑(dev server / watch script)· 返回 PID + log path |
| `local.kill` | IRREVERSIBLE | 杀 PID(只能杀我们 spawn 的) |

### 4.3 Tier 2(OS Automation · 8 个 · 平台分发)

| Tool | platform | scope | 备注 |
|---|---|---|---|
| `os.osascript` | macOS | IRREVERSIBLE | 任意 AppleScript · 受 Automation/Accessibility 权限制约 |
| `os.shortcut.list` | macOS | READ | `shortcuts list` |
| `os.shortcut.run` | macOS | IRREVERSIBLE | `shortcuts run "Name"` 跑 Shortcut |
| `os.notification` | 跨平台 | WRITE | macOS osascript display · Linux notify-send · Win toast |
| `os.imsg.send` | macOS | IRREVERSIBLE | 发 iMessage(osascript) |
| `os.mail.send` | macOS | IRREVERSIBLE | Mail.app 发邮件 · 草稿模式可选 |
| `os.calendar.add` | macOS | IRREVERSIBLE | Calendar.app 加事件 |
| `os.powershell` | Win | IRREVERSIBLE | 任意 PS · execution_policy 守 |
| `os.dbus_call` | Linux | IRREVERSIBLE | dbus-send 包装 · KDE/GNOME 通用 |

### 4.4 Tier 3(GUI / Computer Use · 7 个)

走 Anthropic Computer Use API(beta header `computer-use-2025-11-24`)+ Playwright。**默认 deny,用户首次启用要在 Settings 里勾 "Enable Computer Use" + 给 macOS Accessibility 权限**。

| Tool | scope | 备注 |
|---|---|---|
| `gui.screenshot` | READ | 整屏 / 单 app · 截图回传(base64) |
| `gui.read_screen` | READ | 截屏 + Claude 视觉描述当前界面 |
| `gui.click` | IRREVERSIBLE | 坐标点击 · 含 cmd/ctrl/shift modifier |
| `gui.type` | IRREVERSIBLE | 当前焦点输入 |
| `gui.key` | IRREVERSIBLE | 单键 / 组合键 |
| `browser.open_url` | WRITE | 默认浏览器开 |
| `browser.playwright_session` | IRREVERSIBLE | Playwright 受控会话 · navigate/click/fill/scrape · 返回 DOM 摘要 |

### 4.5 Tier 4(MCP Server · 我们做 host)

**架构:** allhands 实现 MCP host(参考 Goose / Claude Code) · 用户在 settings 里:
- 输入官方 registry URL(`https://registry.modelcontextprotocol.io`)→ 浏览 + 一键装
- 或手填 `mcp.json` 块 · 同 Claude Code/Cursor 的格式

**首次启动预装的精选 server(可选 opt-in · 都装)** —— 来自 registry top installs:

| Server | 来源 | 安装量 | 干什么 |
|---|---|---|---|
| `filesystem` | 官方 | 485k | (我们已自有 local.* · MCP 版本主要给"扩 cwd 外路径"场景) |
| `github` | 官方 | 398k | PR / issue / repo 操作 |
| `postgres` | 官方 | 312k | 只读 SQL |
| `brave-search` | 官方 | 287k | web search |
| `slack` | 官方 | — | 频道 / DM / 历史 |
| `gmail` | 官方 | — | 邮件 R/W |
| `google-calendar` | 官方 | — | 日历 R/W |
| `notion` | 官方 | — | 知识库 |
| `linear` | 官方 | — | 任务 |
| `puppeteer` | 官方 | — | (Tier 3 已有 Playwright · 可作降级备选) |

每个 MCP server 的所有 tool **自动按服务器名前缀**(如 `mcp.github.create_issue`)进 ToolRegistry · 共享同一 PermissionGate · 用户能针对单个 MCP tool 加规则。

### 4.6 Meta Tool(8 个 · 自我扩展 + 配置)

| Tool | scope | 备注 |
|---|---|---|
| `meta.permission_grant` | WRITE | (v1 已规划) |
| `meta.permission_revoke` | WRITE | |
| `meta.permission_test` | READ | |
| `meta.create_skill` | WRITE | **核心新能力** · 把当前会话(或指定消息范围)封成 SKILL.md · 写入 `~/.allhands/skills/learned/` |
| `meta.create_tool` | WRITE | 把 agent 写好的脚本封成 backend tool · 注册 + reload |
| `meta.list_my_skills` | READ | 列 builtin + learned skills |
| `meta.install_mcp` | WRITE | `meta.install_mcp("github", config={...})` |
| `meta.update_setting` | WRITE | 通用配置改写口(workspace / sandbox 模式 / model 选择等) |

---

## 5 · 权限模型 V2 · 五级层次

v1 是简单 JSON 三态 · V2 加 4 个维度让"日常零打扰 + 关键场景强守门"成为可能:

### 5.1 Workspace Trust(借鉴 OpenAI Codex)

```json
{
  "workspaces": {
    "/Users/me/code/work": { "trust": "trusted" },
    "/Users/me/Downloads": { "trust": "untrusted" },
    "default": { "trust": "trusted" }
  }
}
```

- **trusted** workspace · 走当前 profile(balanced/trusted)
- **untrusted** workspace · 强制 paranoid · 跳过项目级 `.allhands/` 配置(防止恶意目录注入)

### 5.2 Tool Category Auto-Approve(借鉴 Cline)

5 个 toggle · 大颗粒度 · 80% 用户只用这层:

```json
{
  "auto_approve": {
    "read": true,           // local.read / list_dir / glob / grep / find_natural
    "write": false,         // local.write / edit / move / copy
    "execute": false,       // local.bash / run_python / run_node / spawn_long
    "browser_gui": false,   // browser.* / gui.*
    "mcp": false,           // mcp.* (作为整体)
    "max_calls_before_recheck": 50  // 每 50 次调用后重弹一次确认 · 防止 agent 跑飞
  }
}
```

### 5.3 Pattern 规则(v1 已有 · 保留)

```json
{
  "permissions": {
    "default_mode": "ask",
    "allow": ["local.bash(git status)", "local.bash(git diff:*)"],
    "ask":   ["local.write"],
    "deny":  ["local.bash(sudo:*)", "local.bash(rm -rf /*)"]
  }
}
```

### 5.4 YOLO Mode(借鉴 Cline)

`yolo: true` 全局禁用所有 confirmation · 给 advanced user。开启时 UI 顶部红条提醒。

### 5.5 Sandbox Mode(借鉴 Codex)

```json
{
  "sandbox": {
    "mode": "light",            // off | light | strict (V2 默认 light · v1 是 off)
    "deny_network": false,
    "fs_writes_outside_workspace": "ask"  // allow | ask | deny
  }
}
```

- **off:** 完全裸跑(不推荐)
- **light(新默认):** macOS sandbox-exec 限文件写域 + Linux Landlock 限 write roots · 网络默认开
- **strict:** light + 网络 deny 白名单 + seccomp 限危险 syscall

### 5.6 决策合流图

```
Tool Call → ① YOLO?           → 是 → ALLOW
            ② Sandbox 边界?    → 越界 → DENY
            ③ Workspace 信任?  → untrusted + WRITE → 强制 ASK
            ④ Pattern 规则?    → 命中 deny/allow/ask
            ⑤ Auto-approve cat?→ category=allow → ALLOW
            ⑥ default_mode    → ASK
```

---

## 6 · 长期记忆架构(Mem0 风格三层)

> v1 完全没有这个 · agent 健忘是最大体验缺陷 · V2 必须解决。

### 6.1 三层模型(借鉴 Letta / Mem0)

| 层 | 容量 | 何时用 | 实现 |
|---|---|---|---|
| **Core** | ≤ 2KB | 永远在 context | 注入 system prompt 末尾 · 用户的"档案"(姓名 / 公司 / 偏好 / 当前关注项目) |
| **Recall** | 全部历史 | agent 主动 search | SQLite FTS5 全文索引 · `memory.recall("我们上次怎么处理 sales.xlsx")` |
| **Archival** | 大块文件 / 知识 | agent 主动 search | sqlite-vec(SQLite + vec0)向量索引 · `memory.archival("我以前的 SOP 写过类似的")` · 不引入外部 vector DB |

### 6.2 不做向量服务依赖 · 全在 SQLite

`sqlite-vec` 已经是生产可用的 embedding extension(2025.1 GA · ~50KB)· 单文件 · 跟我们现有 SQLite 同进程 · 不需要额外 service。

### 6.3 Spotlight 作"零成本 RAG"(macOS 关键创新)

mdfind 已经索引了用户全机 125+ 元数据属性 · 文档全文 · 邮件 · 联系人。我们**不复制这个索引**,而是给 agent 一个 `local.find_natural` tool 直调 mdfind:

```
agent:"找我上个月跟客户 X 讨论合同的所有文件"
       → local.find_natural("kMDItemContentModificationDate >= '2026-03' && '客户 X' && 合同")
       → mdfind 0.1s 返回 N 个路径
       → agent.local.read 读重点几个 → 答用户
```

**比维护自己的 RAG 索引便宜两个数量级**。Linux/Win 上有降级:`locate` + `recoll` / Windows Search COM。

### 6.4 记忆生命周期 tool

| Tool | scope | 用途 |
|---|---|---|
| `memory.store_core` | WRITE | 写一条 ≤500 字符进 core(用户档案 / 长期偏好) |
| `memory.recall_search` | READ | FTS5 搜历史会话 |
| `memory.archival_save` | WRITE | 存大块文档 + 自动 embedding |
| `memory.archival_search` | READ | 向量召回 top-K |
| `memory.forget` | IRREVERSIBLE | 删一条(支持 GDPR-style "请忘掉")|

---

## 7 · Skill 自合成(Self-Synthesis)

> 灵感:`anthropics/skill-creator` 工作流 —— "完成长任务后,问 agent 要不要把刚学的封成 skill"。

### 7.1 触发场景

1. **会话结束时**:UI 在对话末尾显示一个 ghost button "把这次的方法封成 skill"
2. **agent 主动建议**:连续 3 个相似任务后,Lead Agent 在 system prompt 收到 hint "你看起来重复做同一类事 · 提议 user 封 skill"
3. **用户明令**:对话 "把刚才操作 sales.xlsx 的方法保存成 skill 叫 monthly-rec"

### 7.2 流程

```
① meta.create_skill(scope="last_5_messages", name="monthly-rec")
② Lead Agent 分析消息 · 抽出
   - description (≤50 字符)
   - 用了哪些 tool
   - 用了哪些 skill
   - 关键步骤(去掉用户特定数据)
③ 生成 SKILL.yaml + body.md(套 anthropics/skill-creator 模板)
④ 写入 ~/.allhands/skills/learned/<slug>/
⑤ 立即 hot-reload · 进 SkillRegistry
⑥ 返回 user "已保存为 skill `monthly-rec`,下次说 '跑 monthly-rec' 直接复用"
```

### 7.3 沉淀位置

```
~/.allhands/skills/
├── builtin/        # 我们随产品发的(excel-ops · file-organize · ...)
└── learned/        # 用户自己沉淀的 · git-managed
```

`learned/` 目录默认是个 git repo,用户能 push 到自己的 GitHub 跟同事分享。这就是 anthropics/skills repo 的私人版本。

### 7.4 Tool 自合成(实验性 · Phase 6)

更激进:让 agent **直接造 backend tool**:

- agent 写一段脚本 + JSON Schema · 测通后调 `meta.create_tool(...)` · 我们把它注册成 `learned.tool.<name>`
- 默认进沙箱 · scope 强制 IRREVERSIBLE · 用户必须显式 `meta.promote_tool` 提升才放宽

风险显著(自动生成代码注入)· 默认 disable · 只在用户开启 "Tool Synthesis" 实验开关后启用。

---

## 8 · Proactive 层 · 让 agent 主动起来

> v1 是纯被动 · 用户开页面才动 · V2 加触发器让员工"在后台帮你看着"。

### 8.1 三种触发器

| 触发器 | 例 | 配置 |
|---|---|---|
| **File watcher** | 监听 `~/Downloads/*.xlsx` · 一掉就让"对账员工"分类归档 | `~/.allhands/triggers/*.yaml` |
| **Cron** | 每天 8:30 让"晨报员工"发昨日总结到 Slack | 同上 · cron 表达式 |
| **Webhook** | GitHub 给 PR 推 webhook · 触发"reviewer 员工"过一遍 | 同上 · 监听端口 |

### 8.2 trigger.yaml 示例

```yaml
name: "downloads-xlsx-archive"
trigger:
  type: fs
  path: ~/Downloads
  pattern: "*.xlsx"
  event: created
employee: archiver
prompt: |
  新文件 {{event.path}} 出现在 Downloads。请按文件名规则归档到合适目录,
  归档后告诉我移到了哪。
permission_profile: trusted   # 该触发的对话用哪个 profile
notify_on_completion: true    # 系统通知用户
```

### 8.3 实现:独立 daemon process

`allhands-daemon`(separate Python process · supervisor 起)· uvicorn reload 不影响它 · 启动时读取 `~/.allhands/triggers/`· 用 `watchdog` 监 fs · `apscheduler` 跑 cron · `aiohttp` 收 webhook · 触发时通过 backend HTTP 调 `POST /api/conversations` 起一个新会话。

### 8.4 用户体验

- Settings 加 "Triggers" tab · 列所有触发器 · 启停 · 看历史
- 每次触发 → 系统通知 · 点开直接进对应会话
- 失败重试 · 指数退避 · 第 3 次失败只通知不重试

---

## 9 · MCP Host 实现

> v1 完全没考虑 · V2 让我们接通 3000+ MCP server 生态。

### 9.1 协议层

走 [Model Context Protocol Python SDK](https://github.com/modelcontextprotocol/python-sdk) · 我们是 host(client 角色)。每个用户配置的 MCP server 在独立子进程跑 · stdio / HTTP+SSE 都支持 · 进程崩溃自动重启。

### 9.2 配置文件

`~/.allhands/mcp.json` · 跟 Claude Desktop/Code/Cursor 完全同格式(便于用户搬):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }
    },
    "postgres": {
      "command": "uvx",
      "args": ["mcp-server-postgres", "postgresql://..."]
    }
  }
}
```

### 9.3 Tool 注册

启动时遍历 mcpServers → 子进程发 `list_tools` → 每个返回的 tool 包成我们 `Tool` model · id 加前缀 `mcp.<server>.<tool>` · scope 默认 IRREVERSIBLE(unless server 描述里标 read-only) · 进 ToolRegistry。

### 9.4 UI 一键装

Settings → MCP tab → "Browse Registry" 拉 registry.modelcontextprotocol.io 的列表 → 卡片显示 description / install count → "Install" 写 mcp.json · 重启子进程。

---

## 10 · 项目结构(完整 V2)

```
backend/src/allhands/
├── core/
│   ├── domain/permissions.py          # PermissionRule · WorkspaceTrust · SandboxMode
│   ├── domain/memory.py                # CoreMem · Recall · Archival models
│   ├── domain/triggers.py              # Trigger · TriggerEvent
│   └── domain/skill_meta.py            # LearnedSkill metadata
├── persistence/
│   ├── stores/permission_store.py
│   ├── stores/memory_store.py          # SQLite + sqlite-vec
│   ├── stores/trigger_store.py
│   └── stores/learned_skill_store.py   # filesystem-backed
├── execution/
│   ├── permission_resolver.py
│   ├── tools/
│   │   ├── local/                      # Tier 0 · 16 个
│   │   ├── script/                     # Tier 1 · 7 个
│   │   ├── os/                         # Tier 2 · 8 个 · platform 子模块
│   │   │   ├── macos.py · windows.py · linux.py
│   │   ├── gui/                        # Tier 3 · Anthropic Computer Use 包装
│   │   ├── browser/                    # Tier 3 · Playwright
│   │   └── meta/                       # 8 个 meta tool
│   ├── mcp/
│   │   ├── host.py                     # MCP host · 子进程管理
│   │   ├── registry_client.py          # 拉 registry.modelcontextprotocol.io
│   │   └── adapter.py                  # MCP tool → 我们 Tool model
│   ├── sandbox/
│   │   ├── runner.py (ABC)
│   │   ├── passthrough.py · macos_seatbelt.py · linux_landlock.py · windows_appcontainer.py
│   ├── memory/
│   │   ├── core_memory.py
│   │   ├── recall.py                   # SQLite FTS5
│   │   └── archival.py                 # sqlite-vec
│   └── skill_synthesizer/
│       ├── extract.py                  # 从消息抽流程
│       └── render.py                   # 套 anthropics/skill-creator 模板
├── proactive/                          # 独立 daemon
│   ├── daemon.py                       # 入口 · supervisor 起
│   ├── fs_watcher.py · cron.py · webhook.py
│   └── dispatcher.py                   # 触发 → POST /conversations
├── services/
│   ├── permissions_service.py
│   ├── memory_service.py
│   ├── triggers_service.py
│   └── mcp_service.py
└── api/routers/
    ├── permissions.py
    ├── memory.py
    ├── triggers.py
    └── mcp.py

web/
├── app/
│   ├── welcome/page.tsx                # 3 步向导 + Computer Use 开关 + MCP 一键装
│   ├── settings/permissions/page.tsx
│   ├── settings/triggers/page.tsx      # 触发器 CRUD
│   ├── settings/mcp/page.tsx           # MCP server 管理 + browse registry
│   └── settings/memory/page.tsx        # 看 / 删记忆
├── components/
│   ├── permissions/   # v1 已有
│   ├── triggers/      # 新
│   ├── mcp/           # 新
│   └── memory/        # 新

skills/builtin/
├── excel-ops · file-organize · cleanup-junk · code-edit · pdf-extract  # v1 五个
├── invoice-classify · email-triage · meeting-prep   # V2 新增三个 macOS 场景
└── morning-digest · weekly-review                    # V2 配合 proactive 用
```

---

## 11 · 分阶段实现(V2 · 7 phase · 15-18 天)

> 仍然 phase 独立可合 main · 不强迫一次到位。

### Phase 1 · Local Executor + 权限引擎 + Agent 一句话(3-4 天)
**= v1 Phase 1 · 不变** · 落地 16 个 Tier 0 + 8 个 Tier 1 + 8 个 meta tool + 5 级权限模型

### Phase 2 · 5 个内置 Skill + Setup(1-2 天)
**= v1 Phase 2 · 不变**

### Phase 3 · 无感引导 + 可视化权限页(2 天)
**= v1 Phase 3 · 不变**

### Phase 4 · OS 自动化 Tier 2(2-3 天)
- 落地 8 个 `os.*` tool · macOS 优先(osascript / Shortcuts CLI / notification / Mail / iMessage / Calendar)
- Win / Linux 给 stub(返回 NotImplementedError + 友好提示)
- 测试:用 Shortcuts 跑一个 "deeplink to Apple Notes" 案例

### Phase 5 · MCP Host(2 天)
- `execution/mcp/host.py` + 子进程管理
- 配置文件 + UI 一键装
- 接通 github / postgres / brave-search 三个 server 作演示
- L01 回归扩到 MCP tool(也算 Tool First 双入口语义)

### Phase 6 · 长期记忆 + Spotlight RAG(2 天)
- `sqlite-vec` 集成 · core/recall/archival 三层
- `local.find_natural`(mdfind 包装)
- Settings → Memory 页 · 看/删

### Phase 7 · Computer Use + 浏览器(2 天)
- Anthropic Computer Use API 接通(beta header)
- `gui.*` 7 个 tool
- Playwright 集成 · `browser.playwright_session`
- Settings 加 "Enable Computer Use" 开关 · 默认关 · 开了引导用户给 macOS Accessibility 权限

### Phase 8 · Proactive Daemon(2 天)
- `allhands-daemon` 独立进程 · supervisor 启动
- watchdog + apscheduler + aiohttp
- Settings → Triggers 页

### Phase 9 · Skill 自合成(1-2 天)
- `meta.create_skill` 实现
- 套 anthropics/skill-creator 模板
- UI ghost button "封 skill"

### Phase 10(可选 · 实验) · Tool 自合成(1 天)
- `meta.create_tool` · 默认 disable · 高风险

**总:15-18 工作日**(Phase 1-9 必做 · Phase 10 实验)

---

## 12 · 风险与对策(V2 新增)

| # | 风险 | 来源 | 对策 |
|---|---|---|---|
| R1 | macOS Accessibility 权限弹窗扰民 | Tier 2/3 | 首次需要时一次性引导 · 用 Shortcuts 替代部分 osascript(Shortcuts 不需要 Accessibility) |
| R2 | Computer Use API 成本(每次截屏 ~3K tokens) | Tier 3 | system prompt 注入"先试 Tier 0-2 · 失败再 Tier 3" · UI 上长任务实时显示 token 用量 |
| R3 | MCP 子进程崩溃 / 卡死 | Tier 4 | supervisor 监控 · 30s 无响应 kill+重启 · 3 次连续崩溃禁用并通知 |
| R4 | Proactive 触发跑飞(死循环 / 误删) | Phase 8 | trigger 默认带 `max_runs_per_hour: 5` · 触发跑的会话强制 paranoid profile · 关键操作仍弹通知确认 |
| R5 | Learned skill 污染 builtin | Phase 9 | 物理隔离目录 · UI 区分标识 · 不能覆盖同名 builtin |
| R6 | sqlite-vec 文件膨胀 | Phase 6 | 定期 vacuum · UI 显示存储占用 · 用户能"清理 30 天前的 archival" |
| R7 | 用户搬来恶意 MCP server | Tier 4 | install 前展示 server 提供的 tool 列表 + scope · 用户必须勾确认 |
| R8 | macOS Sequoia 起 mdfind 慢 / 索引未建 | Tier 0 find_natural | 检测 `mdutil -s /` · 未索引则降级到 `find` 警告"性能差" |
| R9 | Computer Use 误操作 | Tier 3 | 首次启用要 1 步演示("我点桌面 Finder · 你看截图") · 让用户建立信任 |
| R10 | Tool 数太多 → agent 选错 | 整体 | system prompt 严格 tier 优先级 · 对低 tier 的 tool 在 description 里标注 "expensive · use only when X" |

---

## 13 · 决策清单 V2(15 项 · 比 v1 多 5)

v1 D1-D10 全部沿用 · 新加:

| # | 问题 | 默认 |
|---|---|---|
| D11 | Sandbox 默认值 | **light**(不是 v1 的 off · 借鉴 Codex 默认) |
| D12 | Computer Use 默认值 | **off**(显式 opt-in · 装机后用户自己开) |
| D13 | MCP 预装哪些 server | github / postgres / brave-search 三个 · 都需要用户填 token 才激活 |
| D14 | Learned skill 是否默认开 git | 是 · `~/.allhands/skills/learned/` 自动 `git init` |
| D15 | Proactive daemon 跟 backend 同生命周期? | 不同步 · daemon 是 service · backend 退也跑 · 这样"晨报"才真能晨报 |

---

## 14 · 与 v1 关系 · 兼容承诺

V2 是 v1 的**严格超集**:
- Phase 1-3 完全不变(v1 已经 ready)
- Phase 4 起的所有 tool / module 都是新增 · 不动 v1 类型
- v1 的 `permissions.json` 直接用 · 多出的字段(workspace trust / auto_approve / sandbox / yolo)是 optional · 缺省取默认值 · 老配置零迁移

如果你只想做到 v1 的范围 · 也完全 OK · 不强迫吃 V2 全套。

---

## 15 · 落地建议(给你拍板)

3 个推荐路径:

- **路径 A · 稳健** · 只做 v1 的 Phase 1-3(8 天) · 体验 + 反馈 · 然后再决定要不要进 V2
- **路径 B · 平衡** · v1 Phase 1-3 + V2 Phase 4(macOS OS 自动化)+ Phase 6(记忆 + Spotlight)= 12 天 · 拿到"全知全能"的 70% 体验
- **路径 C · 全量** · V2 全部 9 个 phase = 15-18 天 · 真正达到"在我电脑上无所不能"

我建议 **B**(平衡) —— GUI Computer Use 和 Proactive 这两个虽然惊艳但有 macOS 权限障碍 · 留作"用户提了再加"。MCP 也可以推迟到第二批,等社区 server 质量更稳。

但如果你说"我就要全",我们就走 **C**。

---

## 16 · 参考资料(本次迭代来源)

- OpenHands [runtime architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime) · [SDK paper arxiv](https://arxiv.org/html/2511.03690v1)
- Cline [auto-approve docs](https://docs.cline.bot/features/auto-approve)
- Goose [MCP integration](https://goose-docs.ai/) · 70+ extensions
- OpenAI Codex [sandbox docs](https://developers.openai.com/codex/concepts/sandboxing) · workspace trust
- Anthropic [Computer Use API](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- [MCP registry](https://registry.modelcontextprotocol.io) · 10k servers
- [anthropics/skills](https://github.com/anthropics/skills) · skill-creator
- macOS [mdfind 介绍](https://ss64.com/mac/mdfind.html) · 125+ metadata
- Mem0 [long-term memory](https://mem0.ai/blog/long-term-memory-ai-agents) · 三层模型
- sqlite-vec(SQLite vector extension) · single-file
- Claude Code [sandbox 解析](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes)

---

## 17 · 全景对比 · allhands V2 vs 全行业

| 能力 | OpenHands | Cline | Goose | Claude Code | Codex | **allhands V2** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 部署形态 | self-host · docker | VSCode ext | desktop app | CLI | CLI | **web · 多端 · 多员工** |
| 多用户 / 协作 | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |
| Tool 数 | 30+ | 15+ | 70+ ext | 10+ | 12+ | **40+ · 6 tier** |
| Sandbox 默认 | container | n/a | n/a | off | **light(workspace-write)** | **light** |
| 三入口配权限 | ❌ | ⚠️ UI | ⚠️ CLI | ⚠️ JSON | ⚠️ TOML | **✅ UI/弹窗/Agent** |
| Long memory | ❌ | ❌ | ⚠️ | ❌ | ❌ | **✅ 3 tier · sqlite-vec** |
| Spotlight 集成 | ❌ | ❌ | ❌ | ⚠️(用户自己用) | ❌ | **✅ tool 内置** |
| Computer Use | ❌ | ⚠️ headless browser | ⚠️ ext | ✅(2026.3) | ❌ | **✅** |
| MCP host | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | **✅ + 一键装 registry** |
| Proactive 触发 | ❌ | ❌ | ❌ | ⚠️(/loop) | ❌ | **✅ fs/cron/webhook** |
| Skill 自合成 | ❌ | ❌ | ⚠️ recipe | ⚠️ skill-creator | ❌ | **✅ 一键封会话** |
| Tool 自合成 | ❌ | ❌ | ❌ | ❌ | ❌ | **⚠️ 实验** |

差异化:**多用户协作 + 三入口权限 + Spotlight RAG + 自合成 Skill** —— 这 4 个我们独有。

---

> **End of PLAN-V2** · 总长 ~ 1100 行 · 经 10 轮调研迭代 · 见 [ITERATIONS.html](ITERATIONS.html)。

# PLAN-V2 自批 · 15 个洞 + V3 补丁

> Round 11-15 自批结果。每个洞列:**问题描述 → 严重度 → V3 补丁**。
> 不重写 PLAN-V2,作为"V3 patch"贴边补充。
> 2026-04-26

---

## 🔴 严重(影响落地)

### H1 · Tier 优先级 system prompt 注入靠不住

**问题:** V2 § 3 说"Lead Agent 工具优先级 5→4→2→1→0→3"靠 system prompt 注入。但实际 agent 看到 40+ tool 时,会被 description 里"功能强大"的字眼吸引,经常优先选 Computer Use 这种贵的。

**严重度:** 🔴 高 · 直接影响成本(每次截屏 ~3K tokens · 10 步 = 30K)

**V3 补丁:**
- **硬 gating 而非软引导**:Computer Use tool 默认从 ToolRegistry **移除**,只有 Settings 里勾"Enable Computer Use" + 当前 conversation 显式标 `mode=visual` 时才暴露
- 在 system prompt 不仅说"Tier 优先级",还每个 tool description 末尾加"**cost: $0.01/call**"等具体数字
- 加 tool budget 守门:每会话 `gui.*` 调用次数 > 5 → 自动询问用户"要继续视觉操作还是换思路"

---

### H2 · Skill 自合成的"3 次相似任务"判断不可靠

**问题:** V2 § 7 说 agent 主动建议封 skill 的触发条件是"连续 3 次相似任务"。但"相似"怎么判?embedding 比对?成本 + 误判风险都高。

**严重度:** 🔴 中高 · skill 体系核心机制不能拍脑袋

**V3 补丁:**
- 砍掉"主动建议"机制 v0
- 只留**两种触发**:① 用户明令"封成 skill"② 会话末尾固定 ghost button
- v1 上线 3 个月观察用户用 ghost button 的频率 + 内容 · 再决定要不要做"主动建议"
- 加 telemetry:每次 skill 创建后追问"用得怎样?有没有少做什么?" · 收集 skill 质量数据

---

### H3 · Spotlight 自然语言查询太理想化

**问题:** V2 § 6.3 把 macOS `mdfind -interpret` 描绘成"自然语言魔法"。实测:复杂 query 如"上个月跟客户 X 讨论的合同"经常返回空 / 噪声大。

**严重度:** 🔴 中 · 影响"零成本 RAG" 卖点的可信度

**V3 补丁:**
- `local.find_natural` 内部不直接喂 `-interpret` 用户原话 · 而是 LLM 先把自然语言**翻译成 mdfind query**(如 `kMDItemContentModificationDate >= '2026-03-01' && kMDItemTextContent CONTAINS "客户 X" && kMDItemFSName == "*合同*"`)
- 翻译失败或返回 0 时 · 降级到 `find ~/{Documents,Desktop} -mtime -30 -type f` + grep
- description 里诚实说"基于 macOS Spotlight 索引 · 复杂查询可能不准 · 失败时会降级"
- 不删卖点 · 但加"已知局限" footnote

---

### H4 · Proactive 跑飞防护不够

**问题:** V2 § 8 说"max_runs_per_hour: 5 + paranoid profile"防跑飞。但 paranoid profile 仍允许 read · 一个 trigger 用 LLM 处理大文件,token 烧爆 / 慢 / 卡线程都可能。

**严重度:** 🔴 高 · 用户白天上班 trigger 后台烧钱不知道

**V3 补丁:**
- 加**硬资源 quota**(配置在 trigger.yaml):
  - `max_tokens_per_run: 5000`(单次跑超就强制截断)
  - `max_seconds: 60`
  - `max_tool_calls: 20`
- 超 quota → 自动停 + 系统通知"trigger X 超 quota · 跑了 N 秒 · 烧了 M tokens · 已停"
- daemon 启动时检测当前 LLM provider 余额 < $5 → 全部 trigger 暂停 + 通知

---

### H5 · sandbox-exec 在 macOS 已 deprecated

**问题:** V2 § 5.5 说"light 模式用 macOS sandbox-exec"。但 Apple 自 macOS 11 起把 sandbox-exec 标 deprecated · 文档警告随时可能移除 · 写 profile 是黑魔法 · 出错难调。

**严重度:** 🔴 高 · 默认值 light 在 macOS 上可能直接坏掉

**V3 补丁:**
- macOS sandbox 模式下 · **不用 sandbox-exec** · 改用应用层守门:
  - `local.bash` cwd 强制在 `allowed_roots` 内
  - 写文件路径 normpath 后 startswith allowed_roots 才放行
  - 网络靠 LLM provider 端控制(我们的 model_gateway 已能拦)
- light 模式重命名"<strong>workspace-only</strong>"(更准 · 不暗示有 OS 级护栏)
- D11 默认值仍然 light · 因为应用层守门也算护栏

---

## 🟡 中等(产品体验影响)

### H6 · MCP 子进程 macOS 权限弹窗扰民

**问题:** 装 5 个 MCP server = 5 次 npx 拉网络 = 5 次 macOS Network Outgoing 弹窗(Little Snitch 等)+ 部分 server 要 Accessibility = 多次 TCC 弹窗。

**严重度:** 🟡 中 · 首次体验崩

**V3 补丁:**
- MCP server 启动 batch 化 · 一次串行起所有 · 弹窗集中
- 启动前 README 一段说"接下来会请求多个权限 · 都是 MCP server 联网 / 文件 · 可一一确认"
- 文档示例都用 `uvx` / `npx -y` 避免 install prompt

---

### H7 · Computer Use 延迟 + 中断机制缺

**问题:** V2 § 4.4 说 Tier 3 工具但没说"用户点'我来'接管"机制。Computer Use 一步 2-5s · 走 10 步 = 20s+ · 用户中途想介入没办法。

**严重度:** 🟡 中

**V3 补丁:**
- chat UI 里 Computer Use 跑的时候顶部一直有"<strong>暂停 / 我来</strong>"按钮
- 点暂停 → 当前 step 完后停 · 截图给用户看 · 用户可输入"接下来用键盘输 X" 或 "你接管不了 · 我自己来"
- agent 收到"我来"后保存 trace · 等用户回复

---

### H8 · Settings 配置项爆炸

**问题:** V2 加了 5 级权限 + 沙箱 + Computer Use 开关 + 触发器 + MCP + Memory 配置 + Skill 管理 + ... Settings 页 N 个 tab · 普通用户找不到。

**严重度:** 🟡 中 · UI 设计要重新过一遍

**V3 补丁:**
- Settings 二分:**基础**(Workspace · Permission profile · MCP)+ **高级**(沙箱 mode · auto-approve cat · trigger quota · memory · ...)
- 基础 = 一页搞定 · 默认用户只看到这一页
- 高级 = 折叠 · 点"显示高级"才出现
- 每个高级配置加"什么时候你需要改这个" tooltip

---

### H9 · 学到的 skill 跨用户共享缺设计

**问题:** V2 § 7 说 learned/ 默认 git init 用户能 push 分享。但**别人 pull 后怎么 install 进自己的 ~/.allhands/skills/**?没说。

**严重度:** 🟡 中 · 影响 V2 杀手锏(skill 网络效应)

**V3 补丁:**
- 加 `meta.install_skill_from_url`(Github URL · git tag · folder path)tool
- learned/ skill 自动加 README.md 说明 install 方法:
  ```
  git clone https://github.com/user/awesome-skill ~/.allhands/skills/learned/
  # 或者一句话:
  对话:从 https://github.com/user/awesome-skill 装 skill
  ```
- v2 后期做 "Skill Marketplace" 单独项目(不在 V2 范围)

---

### H10 · Mem0 记忆隐私缺加密

**问题:** V2 § 6 把"用户每天的事"全存 SQLite · 多用户场景下别的 OS 用户能直接读 SQLite 文件 · core memory 注 system prompt 也可能漏到 LLM provider 日志。

**严重度:** 🟡 中

**V3 补丁:**
- SQLite 文件权限默认 0600(只 owner 读写)
- archival 文本 + embedding 走 SQLCipher · 用 keychain 存的 key 解密(不需要用户记密码)
- core memory 内容 sensitive 字段(API key · 公司名 · 联系人)agent 不主动写入 · 只有用户明令"记住我的 X"才写
- 加 `memory.list_all` + `memory.export` 让用户能看 / 导出 / 删

---

## 🟢 轻度(锦上添花)

### H11 · 工期低估(macOS osascript 适配地狱)

**问题:** V2 § 11 估 Phase 4(OS 自动化)2-3 天。一个 osascript 发 Mail 草稿能踩 5 个权限坑(Mail.app 信任 · Automation · Full Disk Access)。

**严重度:** 🟢 低 · 主要是预期管理

**V3 补丁:**
- 工期估改:"乐观 2-3 天 · 现实 4-6 天 · 每个 OS tool 加测试 fixture 拍真实环境"
- 路径 B 工期从 12 → 14 天 · 路径 C 从 15-18 → 20-25 天
- v1 Phase 1-3 工期不动(熟练度高)

---

### H12 · 没有"LLM 答得对不对"的客观评估

**问题:** V2 验收全靠人眼。Phase 1 完成后我们怎么知道 agent 不退化?

**严重度:** 🟢 低 · 但长期重要

**V3 补丁:**
- Phase 1 末尾加一组**黄金任务集**(10 个固定 prompt + 期待输出片段)
- CI 跑这组任务 + 跟期待对比(关键字断言)· 每次 release 都跑
- agent 走 trace · trace 跟 last-known-good 对比 tool call 序列(人审一次后存为 baseline)

---

### H13 · 多端同步缺设计

**问题:** 用户两台 Mac 用同一 allhands · permissions / skills / memory 谁是 SoT?

**严重度:** 🟢 低 · v0 单机就行 · v1+ 才需要

**V3 补丁:**
- v0 不做多端同步 · 文档明确"单机部署"
- 但 `~/.allhands/` 目录设计为 git-friendly(纯文本配置 / skills / 不存 binary)· 用户能自己用 git/iCloud Drive/Dropbox 同步
- v1 后期再做 sync service

---

### H14 · MCP 工具滥用没护栏

**问题:** 装了 GitHub MCP server · agent 可能频繁调 list_repos 烧 API 配额。

**严重度:** 🟢 低

**V3 补丁:**
- 每个 MCP server quota:N calls/hour · 满了 graceful 降级"今天该 server 配额满 · 用 local.bash gh 替代"
- Settings → MCP 页显示当日各 server call 数

---

### H15 · 验收没有"试坏" 的护栏验证案例

**问题:** ACCEPTANCE.html § "故意试" 写得简略 · 5 行覆盖不全。

**严重度:** 🟢 低 · 已在 ACCEPTANCE.html 修

**V3 补丁:**
- ACCEPTANCE.html § "遇到问题怎么办" 已加 5 个故意试 · 后续可扩到 15 个(每个 phase 配一组)
- 这是验收文档的活内容 · 持续补

---

## 📋 V3 patch 汇总(给 PLAN 加 5 段)

| 段落 | 在 PLAN-V2 哪 | V3 补丁 |
|---|---|---|
| § 3 (6 tier) | 加 "硬 gating" 段 | H1 · Computer Use 默认从 registry 移除 · 显式开 + mode=visual 才暴露 |
| § 5.5 (sandbox) | 重写 light 定义 | H5 · macOS 不用 sandbox-exec · 改应用层守门 · 改名 workspace-only |
| § 6.3 (Spotlight) | 加 "实际局限" footnote | H3 · LLM 翻译 + 失败降级 · 不再吹"自然语言魔法" |
| § 7 (skill 自合成) | 砍 "3 次相似" | H2 · 只留两种触发 · v1 收数据再做主动建议 |
| § 8 (proactive) | 加资源 quota | H4 · max_tokens / max_seconds / max_tool_calls + 余额 < $5 自动停 |
| § 11 工期 | 改 phase 估时 | H11 · 路径 B 12 → 14 天 · 路径 C 15-18 → 20-25 天 |

(H6/H7/H8/H9/H10 是产品体验改进 · 落到具体 phase 实现时再加)

---

## ✅ 自批结论

- **15 个洞 · 5 个严重 · 5 个中等 · 5 个轻度**
- 严重 5 个都有具体补丁 · **不需要重写 PLAN-V2** · 加这份 CRITIQUE.md 作为 patch
- **核心方向不变** · 6 tier + 5 级权限 + 自合成 + proactive 这套是对的 · 只是细节要 nail 住
- **建议 V3 不做单独文档** · 进入 Phase 1 实施时 · 把 V3 patch 内联到代码注释 + ADR · 这样不会两份文档撕裂

下一步 = 等用户确认路径 + 开 Phase 1。

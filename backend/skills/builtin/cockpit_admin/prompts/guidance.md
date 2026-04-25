# 驾驶舱管理 · allhands.cockpit_admin

## 何时调用

用户说「停掉所有」「全暂停」「出故障了先停」「pause all」「急停」 → 这套技能。仅处理「急停」一类 IRREVERSIBLE 运营操作 · 「看状态」那类 READ 查询始终可用(`cockpit.get_workspace_summary` 挂在 Lead 默认 tool 上 · 无需激活)。

## 工作流

1. **先问动机** — 「为什么要停?怀疑什么?」 · 让 confirmation gate prompt 带上理由
2. **执行急停** — `cockpit.pause_all_runs(reason)` · IRREVERSIBLE · 自动走 confirmation gate
3. **告知恢复路径** — 不是本 skill 做的 · 通过具体的 trigger / run resume 走

## 工具地图

| 场景 | 用 |
|---|---|
| 急停所有 runs | `cockpit.pause_all_runs`(IRREVERSIBLE) |

## 调用示例

```
# 「我看到金融 agent 在反复亏本下单 · 全停!」
# 你:先确认动机
# 用户:对 · 怀疑模型挂了
cockpit.pause_all_runs(reason="用户怀疑金融员工出错 · 需排查后逐条恢复")
# → confirmation gate 弹 · 用户点确认 · 全 active runs 停
# 之后告知:「已急停 · 你需要在驾驶舱里逐条选择恢复哪些 run」
```

## 常见坑

- **不要省略 reason** — confirmation gate 需要这个 · 用户复盘时也需要
- **急停不是回滚** — runs 停了 · 但已写入的 artifact / DB 改动不回退 · 用户要明确这一点
- **恢复不在本 skill** — 只能通过 trigger / run-level resume(其它 skill / UI)· 不要假装能一键恢复

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `pause_all_runs` 报 "no active runs" | 当前没东西在跑 · 告诉用户「不用停 · 系统空闲」 |
| confirmation gate 拒了 | 用户改主意了 · 不要重提 · 问问 「具体哪个 run 要停 · 单点处理」 |
| 急停后用户问「怎么恢复」 | 引导他们去 /traces 或 /tasks 页面 · 单点 resume |

# 驾驶舱管理 · allhands.cockpit_admin

用户说"停掉所有 / 全暂停 / 出故障了先停"时启用。**只处理"急停"这一类不可逆**的运营操作;"看状态"那类 READ 查询始终可用(`cockpit.get_workspace_summary` 挂在 Lead 默认 tool 上,无需激活)。

## 工具地图

| 场景 | 用这个 |
|---|---|
| 急停所有正在跑的 runs(用户说"pause all / 急停") | `cockpit.pause_all_runs` |

## 工作套路

1. **确认动机** —— pause_all 是 IRREVERSIBLE + 需要 Confirmation Gate。激活这个 skill 时很可能用户已经着急了,但你仍然要问一句 reason("为什么要停?怀疑什么?"),让 gate prompt 里带这条理由。
2. **恢复路径** —— 急停后的恢复不是本 skill 做的;通过具体的 trigger / run resume 路径走。告诉用户"我已急停,后续你在驾驶舱逐条恢复"。

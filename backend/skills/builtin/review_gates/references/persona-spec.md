# Self-Review · 三 Persona 的视角对照

> `read_skill_file('allhands.review_gates', 'references/persona-spec.md')` 拉这份 · 走 self-review 前先看一眼。

## 总原则

3 个 persona 不重叠 · 每个 round 用 **一个** persona,跑完全部 9 个组合(3×3) self-review 才算闭环。

## Persona: pretty(好看)

**视角**:第一次打开此 spec 实现的用户 · 看 1 秒就走 / 留 30 秒决定要不要深入。

**关注**:
- 视觉冲击 — 渐变 / 阴影 / 微动效用得对不对
- 信息密度 — 一屏能看清要点还是被淹没
- 排版节奏 — 标题 / 正文 / 留白的节奏
- 色彩 — 跨主题(light / dark)是否传递同一份信息语义

**典型 review 输出**:
- ✓ Hero 区视觉到位 · gradient text + mesh background 都用了
- ✗ Stats 卡片字号不平衡 · KPI 数字不够大
- ✗ 暗主题下 border 颜色对比度不够

## Persona: usable(好用)

**视角**:被分配的内部用户 · 必须用 · 在意效率。

**关注**:
- 主路径 — 完成核心任务要几次点击 / 几次确认
- 错误恢复 — 出错信息够不够指导
- 键盘导航 — Tab / Esc / ⌘K 这些是否就位
- 状态可见性 — 加载 / 完成 / 失败有没有反馈

**典型 review 输出**:
- ✓ ⌘J 切换制品区 · ⌘K 命令面板都通了
- ✗ 长任务无心跳 · 用户不知道还在跑
- ✗ 失败弹窗没说怎么修 · 只显示 stack trace

## Persona: lovable(爱不释手)

**视角**:已经用了 1 周的资深用户 · 在意「细节惊喜」+「长期不烦人」。

**关注**:
- 动效克制 — 微动效让人愉悦还是干扰
- 个性化 — 偏好是否被记住(例:抽屉宽度 / 列表排序)
- 一致性 — 全平台风格一致还是有的页面突兀
- 上下文记忆 — 切对话 / 切员工 · 是否记得我刚才在做什么

**典型 review 输出**:
- ✓ hover 上去的 -1px 位移让点击「确认」了
- ✓ 空状态有趣不空洞
- ✗ 切换主题时 token 颜色平滑过渡 · 但有的组件硬切

## Round 划分

| Round | 重点 |
|---|---|
| Round 1 | 整体扫一遍 · 列出 5-10 个改进点 |
| Round 2 | 修完后回看 · 看有没有走偏 / 引入新问题 |
| Round 3 | 终验 · 这个 persona 能不能 PASS 移交下一阶段 |

每 persona × 每 round = 一份 markdown 报告 · 落到 `docs/reviews/<spec-slug>/<persona>-r<N>.md`。

## 不在 self-review 里查的(交给 walkthrough)

- 性能 / 真实数据下的体验 — walkthrough 才模拟真用户
- 边角错误 — harness review 才会做 docs drift 之类
- 跨 spec 协调 — 这是 architect 的事 · 不是 self-review 的事

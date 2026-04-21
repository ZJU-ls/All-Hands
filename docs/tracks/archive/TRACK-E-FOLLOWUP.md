# Track E · Design Review · Follow-ups

本文档列出 Track E(视觉设计走查)过程中发现、但**超出本轮 50 行改动红线**或与 Track E 目标不直接相关的结构性改造项,留给后续独立 PR 处理。

**本轮已落地**(见 `TRACK-E-DONE.md`):22 个 Raycast 风格 icon + ADR 0009 + SideNav 扁平化 + `/gateway` 顶部 Provider Tabs。

---

## F-01 · `/gateway` 拆分成独立路由(provider detail page)

**现状:** 本轮把 `/gateway` 原左侧 `aside.w-72` ProviderRail 改成了顶部横向 tabs(in-place refactor),避免破坏当前 URL。

**理想形态:** Provider 详情应该独立成路由 `/gateway/[providerId]`,列表页 `/gateway` 只列所有 provider,点进去看详情。这样:

- 地址栏能反映当前选中 provider(方便分享、浏览器前进后退)
- 单列表页更轻,列表 + 详情彻底解耦
- 顶部 tabs 改造只是过渡方案,最终应走 route split

**估工:** 3-4 小时(拆 page、路由参数、状态迁移、测试)

**优先级:** P2 · 不影响 v0 发布

**文件:** `web/app/gateway/page.tsx` · `web/app/gateway/[providerId]/page.tsx`(新)

---

## F-02 · `/observatory` 左侧 summary 列重构

**现状:** `web/app/observatory/page.tsx:138-211` 使用 `aside.w-72` 承载 KPI(Traces total / Failure rate / Latency / Avg tokens)+ by-employee breakdown。右侧 `section` 承载 trace 列表。

**B1 契约允许:** data list 可以走左二级列(chat / observatory traces / cockpit tasks)。当前 observatory 把 "trace 列表" 放在右边,"KPI summary" 放在左边 —— 方向与契约**相反**(允许的是把列表放左边,不是把 summary 放左边)。

**理想形态:**

- KPI summary 改成顶部横条(4 个 metric 并排,h-16 左右)
- By-employee breakdown 改成顶部第二行 chip list 或下拉过滤器
- trace 列表独占主区域(或保留一个可折叠左侧 trace list + 右侧 trace detail)

**估工:** 4-5 小时(重排版 + KPI 横条组件化 + 视觉 QA)

**优先级:** P2 · observatory 页当前功能正常,只是结构不符合 B1 契约

**文件:** `web/app/observatory/page.tsx`

---

## F-03 · `/design-lab` ConceptA/B/C demo 布局

**现状:** `design-lab/page.tsx` 有若干 `aside` 用于展示不同布局概念(A / B / C 三种方案并排)。

**不需要改动:** design-lab 是视觉实验场,允许用任何布局来展示 trade-off。这里留记是为了让未来 reviewer 明白 "这些 aside 是故意的"。

---

## F-04 · 其他页面的 icon 覆盖

**现状:** 本轮给 SideNav 加了 icon,但**页面内部**的按钮(比如 employees 页的 "新建员工"、skills 页的 "安装" 按钮等)仍以文字为主,偶有 mono 字符(`+`)。

**建议:** 待 F-01 等结构整改落地后,统一过一遍:

- 所有 primary action 按钮考虑加 `Icon size={14}`
- `External Link` 场景统一用 `ExternalIcon`
- Confirmation dialog 的确认/取消按钮暂不加 icon(保持纯文本,避免视觉噪音)

**估工:** 2 小时(大部分是 find/replace)

**优先级:** P3 · 不影响纪律,只是一致性打磨

---

## 总结

| ID   | 描述                       | 优先级 | 估工    |
| ---- | -------------------------- | ------ | ------- |
| F-01 | `/gateway` 路由拆分        | P2     | 3-4h    |
| F-02 | `/observatory` 布局调整    | P2     | 4-5h    |
| F-03 | `/design-lab` aside(留记) | —      | 无需改 |
| F-04 | 页面内部 icon 覆盖         | P3     | 2h      |

Track E 收尾后,建议开独立 PR 批次(一个 F = 一个 PR)清理这些项。

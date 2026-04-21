# Track E · 视觉走查 · Done

**分支:** `design-review-pass`(cut from main `686eed3`)
**日期:** 2026-04-19

本 track 把用户在产品视觉走查里定的两个方向从规范改到实装:

- **Icon = A2 Raycast**(2px stroke · 圆润胶囊端 · 光学尺寸 18-22px · currentColor)
- **Nav = B1 扁平**(单列主 nav + 顶部 tabs;不开左二级 column,除非是 data list)

---

## 1. 产物清单

### 1.1 Icon 系统(22 个)

所有 icon 放在 `web/components/icons/`,每个一个 `.tsx`,统一通过 `IconBase` 包装。

| 分区               | Icons                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Nav(12)           | `ChatIcon` `UserIcon` `SkillIcon` `ModelIcon` `PluginIcon` `TriggerIcon` `TaskIcon` `CockpitIcon` `ObservatoryIcon` `ChannelIcon` `MarketIcon` `StockIcon` |
| Composer(4)      | `SendIcon` `StopIcon` `AttachIcon` `ThinkIcon`                                            |
| Viz(4)           | `CheckIcon` `CopyIcon` `ExternalIcon` `SearchIcon`                                        |
| 其他(2)          | `SettingsIcon` `ProviderIcon`                                                              |

规格(锁死):

- viewBox `0 0 24 24` · stroke-width 2 · stroke-linecap/linejoin `round` · fill `none` · `stroke="currentColor"`
- 默认 `size=20`,可通过 props 覆盖
- **禁止 inline 颜色**(回归测试 `tests/custom-icons.test.ts::C02` 锁)
- **禁止第三方 icon 库**(`lucide / heroicons / phosphor / tabler` · `tests/error-patterns.test.ts::E11` 锁)

### 1.2 ADR + 契约文档

- `product/adr/0009-custom-icon-system.md`(新)· Accepted
- `product/03-visual-design.md §0 + §2.7 + §2.8 + §9`(更新)
- `design-system/MASTER.md §0 + §3 + References`(更新)
- `CLAUDE.md §3.5 rule 1`(更新为"禁止第三方 icon 库")

### 1.3 前端实装

- `web/components/shell/AppShell.tsx`:主侧栏每项加 16px icon,激活色条保留,宽 224px
- `web/app/gateway/page.tsx`:`ProviderRail`(左侧 aside w-72)→ `ProviderTabs`(顶部横向 tabs · 2px primary 下划线);api_key 状态点 + 连通性测试状态内联
- `web/app/design-lab/page.tsx`:新增 `IconGallery`(22 个 icon 网格 + size scale 16/20/24/32 + color 继承 demo),挂在 `data-testid="icon-gallery"`

### 1.4 回归测试

- `web/tests/custom-icons.test.ts`(75 个 assertion)锁定:
  - C01 · 每个 icon 必须走 `IconBase`
  - C02 · 禁止 inline fill/stroke(只能 currentColor)
  - C03 · 每个 icon 从 index.ts 导出 · 至少 22 个
  - C04 · AppShell 侧栏每项渲染 Icon · 禁用旧 icon 包
  - C05 · legacy 1-line SVG 保留
  - C06 · design-lab 包含 Icon Gallery

- `web/tests/e2e/_track-e-*.spec.ts` 两个 playwright 脚本(手动触发,默认 skip):
  - 用于刷新 `docs/design-review/screenshots/` 下的 review 截图
  - 跑法:`TRACK_E_SCREENSHOTS=1 E2E_BASE_URL=http://localhost:3005 pnpm exec playwright test _track-e`

### 1.5 视觉截图

11 张截图存在 `docs/design-review/screenshots/`:

| 文件                                 | 说明                                       |
| ------------------------------------ | ------------------------------------------ |
| `01-design-lab-icon-gallery.png`    | design-lab 全页(含三个 concept + gallery) |
| `02-sidenav-chat.png`               | 新 sidebar · chat 页                       |
| `03-sidenav-tasks.png`              | 新 sidebar · tasks 页                      |
| `04-employees.png`                  | employees 列表 + 新 sidebar                |
| `05-gateway-top-tabs.png`           | gateway 顶部 tabs 布局                     |
| `06-observatory.png`                | observatory(含待整改的 left summary)     |
| `07-skills.png`                     | skills 页                                  |
| `08-home.png`                       | 首页                                       |
| `09-sidebar-detail.png`             | sidebar 放大 detail(14 项 · icon 清晰)   |
| `10-gateway-top-tabs-detail.png`    | gateway tabs 放大(2px primary 下划线)   |
| `11-icon-gallery-detail.png`        | icon gallery 放大(22 个 icon + 三 demo) |

---

## 2. 契约更新映射

| 来源                                    | 目标                                          | 改动要点                                   |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| ADR 0009                                | `product/03-visual-design.md §2.7`           | 允许自有 icon 集,规格锁死                 |
| ADR 0009                                | `CLAUDE.md §3.5 rule 1`                      | "禁 icon 库" → "禁第三方 icon 库"          |
| ADR 0009                                | `design-system/MASTER.md §3`                 | 重写 icon 章节(三类:几何 / 自有 / legacy) |
| 用户产品走查(2026-04-19)              | nav 结构                                      | `/gateway` 拆出左 rail → 顶部 tabs         |

---

## 3. 已知待整改(`TRACK-E-FOLLOWUP.md`)

| ID   | 描述                            | 优先级 | 估工 |
| ---- | ------------------------------- | ------ | ---- |
| F-01 | `/gateway` 拆分成独立路由       | P2     | 3-4h |
| F-02 | `/observatory` 左列 KPI 改顶条 | P2     | 4-5h |
| F-03 | `/design-lab` aside(留记)     | —      | —    |
| F-04 | 页面内部按钮 icon 覆盖          | P3     | 2h   |

---

## 4. 提交历史

```
66996a0 [track-e] refactor(nav): flat sidebar with icons + /gateway top tabs
987f825 [track-e] docs(adr): 0009 custom icon system + sync visual contract
a3c25ce [track-e] feat(icons): 22 custom icons in Raycast style + gallery
```

(第 4 个 commit 即本文件 + 回归测试 + 截图,紧随其后。)

每个 commit 之前 `./scripts/check.sh` 全绿,未使用 `--no-verify`。

---

## 5. 验收

- [x] 22 个 icon 全部在 `web/components/icons/`,每个 `.tsx` + `index.ts` 聚合导出
- [x] `/design-lab` 可见 Icon Gallery(22 网格 + size scale + color demo)
- [x] SideNav 每项有 16px icon,激活态保留 2px primary 色条
- [x] `/gateway` 左 rail 已改为顶部 tabs(B1 扁平)
- [x] ADR 0009 + `product/03-visual-design.md` + `CLAUDE.md` + `design-system/MASTER.md` 一致
- [x] 回归测试 `tests/custom-icons.test.ts` 75 条 assertion 全绿
- [x] `./scripts/check.sh` 三次(每 commit 前)全绿
- [x] 截图 11 张已存档

**Track E 完成。** 后续改动走 `TRACK-E-FOLLOWUP.md` 的 F-01 / F-02 / F-04。

# ADR 0009 · 自有 Icon 系统(Raycast-style)

**日期:** 2026-04-19  **状态:** Accepted

## Context

v0 视觉契约([`03-visual-design.md §2`](../03-visual-design.md))禁止使用任何 icon 库(Lucide / Heroicons / Phosphor / Tabler),只允许 5 类 1-line SVG(check / arrow-right / external / copy / plus-minus)+ mono 字符 + 激活色条 + 点阵 logo + 状态点 + Kbd chip。

这条规则的**本意**是拒绝通用 icon 包带来的"便宜感":5000+ 通用图形混搭任何产品,风格漂浮、同质化严重,和 Linear Precise 的精度感相背。

但在实际使用中出现了两处失衡:

1. **主侧栏 nav 完全没有图形识别**:5 组 13 个菜单项纯文字 + 激活色条,视觉太空、扫一眼难以定位;P05/P07(键盘 + 可识别)也被削弱。
2. **Composer / 按钮区缺少语义 icon**:发送 / 停止 / 附件 / 深度思考这些核心交互只能用文字或 mono 字符,信息密度低但可识别度更低。

产品层 review([2026-04-19 视觉走查](../../CLAUDE.md))明确两件事:

- **icon 风格锁定 Raycast**(2px stroke / 圆润胶囊端 / 光学尺寸 18–22px)
- **nav 结构走扁平**(单列主 nav + 顶部 tabs;不开左二级 column)

两件事加起来推翻了"禁一切 icon"的假设。问题从来不是"有 icon"本身,是"用了别人的 icon 库"。

## Decision

**允许一套自有 icon 系统**(`web/components/icons/**`,Raycast 手感),**保留对第三方 icon 库的禁令**。

### 约束(与第三方库区分开来的地方)

- 每个 icon 一个 `.tsx`,写在 `web/components/icons/`,用 `IconBase` 包装
- 规格统一:viewBox `0 0 24 24` · stroke-width 2 · stroke-linecap/linejoin `round` · fill `none` · `stroke="currentColor"`
- 默认 `size=20` `strokeWidth=2`,可通过 props 覆盖
- **禁止 inline color / 多色 / duotone / 填充形**(保持"同一种笔刷画出来"的一致感)
- 新增 icon → 新文件 + `index.ts` 导出一行 + 在 `/design-lab` Gallery 验证光学一致 · 无需 ADR

### 依然禁止

- ❌ `lucide-react` / `@heroicons/react` / `@phosphor-icons/react` / `@tabler/icons-react` 任何一个
- ❌ icon 字体(Font Awesome / Material Icons 等)
- ❌ UI 装饰用 emoji(☀ ☾ ⚙ 等)

### 已有 1-line SVG 集(`web/components/ui/icons.tsx`)

保留不动。它承载的是 `LogoDotgrid` + 主题切换的 sun/moon,和 5 个"仅 5 类允许"的 1-line 图元。新的 nav / composer / viz 统一走 `web/components/icons/`。

## Rationale

- **风格控制从"禁"改为"收口"**:用一套自己画的 icon(规格 + 手感锁死),比用通用库更能捍卫视觉纪律,因为每一个 icon 都要过 review
- **Raycast 是合理的 reference**:它和 Linear 同宗(2px / 冷静 / 精度),深浅色都能 work,不会破坏现有 token 体系
- **22 个够用**:nav 13 + composer 4 + viz 5(check / copy / external / arrow / expand),几乎没有"临时加一个"的压力
- **和 Tool First(ADR-0003)不冲突**:icon 只是图形表达层,不影响 Meta Tool 对等与独立页并存

## Consequences

- **必须更新的契约文件**:`product/03-visual-design.md §0/§2`、`CLAUDE.md §3.8`(2026-04-21 后由 §3.5 调整 · 见 ADR 0011 核心原则 refresh)、`design-system/MASTER.md §3`
- **必须更新的回归测试**:`web/tests/error-patterns.test.ts E11` 已扫 `from "lucide-react"` 等导入,继续生效;新增 icon 不触发 E11(因为是本项目内部相对导入)
- **新旧路径并存期**:`components/ui/icons.tsx` 保留 legacy 5 个 + logo + sun/moon,其他地方改用 `components/icons/`
- **Gallery 活样本**:`/design-lab → Icon Gallery` 是 icon 光学一致性的事实基准,新增 icon 必须在这里可视化对齐再合入
- **未来扩展**:允许新增 icon,但 review 必须问"能不能用现有的"——icon 越少越好

## Alternatives Considered

1. **维持原禁令**:nav 继续纯文字、composer 继续 mono 字符 → 识别度不够,用户 review 已明确打回
2. **接入 lucide-react**:省工但无法锁风格、和 Linear Precise 的手感冲突(lucide 许多图形细节偏"通用友好")→ 拒
3. **允许通用库但外壳化**:在项目里包一层重命名 → 治标不治本,风格仍受上游影响
4. **只加 3–5 个关键 icon,其余保持文字**:nav 内部图形密度不一致,扫视节奏断裂 → 不够狠

选方案 = 自有 22 个 Raycast-style icon,以最小代价换最大一致性。

## References

- [product/03-visual-design.md §0 + §2](../03-visual-design.md)
- [design-system/MASTER.md §3](../../design-system/MASTER.md)
- [web/components/icons/](../../web/components/icons/)
- [/design-lab Icon Gallery](../../web/app/design-lab/page.tsx)
- ADR 0007 Visual Tokens

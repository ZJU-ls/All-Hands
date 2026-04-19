<!--
这份模板对应本仓的 Definition of Done。勾选 = 已做,留空 = 没做(请写原因,别让它隐形)。
-->

## 这个 PR 做了什么

<!-- 一句话。如果一句说不清,先拆 PR。 -->

## 为什么做(动因)

<!-- 关联的 plan / ADR / issue / bug report。 -->

## 我没做什么(Out of scope)

<!-- 和本 PR 方向相关但故意没做的边角,避免 reviewer 以为漏了。 -->

## 下一步建议

<!-- 如果有后续工作要做,留线索。 -->

---

## Definition of Done(必须勾选 · 没做请写原因)

### 代码层
- [ ] `./scripts/check.sh` 全绿(ruff / mypy / import-linter / pytest / pnpm lint / typecheck / test)
- [ ] 新增 / 修改的代码都有测试(每个新行为至少一条)
- [ ] 改 `core/` / `execution/` / `api/` 的 import 没破坏分层契约

### UI 层(涉及 `web/` 才需要)
- [ ] 启动 dev server,浏览器走过**主路径 + 至少 2 个边缘场景**
- [ ] Loading / Empty / Error 三态都看过(P04)
- [ ] 长操作(>2s)有 loading + progress + cancel(P03)
- [ ] 键盘能完成主要操作(P07)
- [ ] 深浅两套主题都看过
- [ ] 对照 `product/03-visual-design.md § 三条最高纪律` 无违反(icon 库 / 原色类 / scale&shadow)

### 契约层
- [ ] 改了产品契约(token / 组件 / error 类型) → `product/` + `design-system/` 已同步
- [ ] 踩到新的 bug 模式 → 已加回归测试(backend `test_error_patterns.py` / web `tests/error-patterns.test.ts`)

### 证据(UI 类必附)
<!-- 贴图或本地录屏。至少:主路径 1 张 + 三态各 1 张。深浅各一也更稳。 -->
- 主路径截图:
- Loading:
- Empty:
- Error:
- 深色:
- 浅色:

---

## Reviewer 速查
- 产品纪律:[`product/`](../product/)(尤其 `03-visual-design.md` · `06-ux-principles.md`)
- 设计系统:[`design-system/MASTER.md`](../design-system/MASTER.md)
- 架构契约:[`product/04-architecture.md`](../product/04-architecture.md)
- 全量检查:`./scripts/check.sh`

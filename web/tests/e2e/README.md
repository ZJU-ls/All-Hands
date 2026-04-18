# Playwright E2E · 使用说明

视觉契约的"活对照":design-lab 必须一直长得跟 baseline 一样,改 UI 风格如果没同步 baseline → CI 变红。

## 一次性初始化(在你自己的机器上)

```bash
cd web
pnpm add -D @playwright/test
pnpm exec playwright install chromium   # 只装 chromium,减少 baseline 引擎漂移
pnpm exec playwright test --update-snapshots   # 生成首批 baseline 图
git add tests/e2e/__screenshots__
git commit -m "test(e2e): add design-lab visual baseline"
```

## 日常

```bash
pnpm exec playwright test           # 跑全部 e2e(需要先 pnpm dev 起 server,或改 playwright.config 打开 webServer 段)
pnpm exec playwright test --ui      # 交互式 debug
pnpm exec playwright test --update-snapshots   # 故意改了视觉契约后刷 baseline
```

## 什么情况下加新测试

- 改了 `design-system/MASTER.md` 列出的视觉契约 → 在 design-lab 上加对应样本 + 截一张
- 修了一个 UI 回归 bug → 对应路由加一条 `toHaveScreenshot` 回归锁
- **不需要**为每个页面都写 E2E。快照数量按"高信号路由"控制(Chat / Gateway / Traces / design-lab 各一张就够了)

## 为什么不让 CI 自动 `--update-snapshots`

baseline 跨机器(macOS vs Linux · chrome 版本)会有几像素差异,CI 上一律 fail 比误过更重要。想改 baseline → 在本地跑 `--update-snapshots` 后提交图片。

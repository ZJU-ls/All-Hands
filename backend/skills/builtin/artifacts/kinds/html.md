# kind: html · 单页交互产出

## 何时用

- 用户说「画个 HTML / 给我 demo / 弄个网页 / 做个仪表盘 / 单页演示」
- 想要可交互(按钮 / 选项卡 / 图表 / 动效)的产出
- 报告里需要嵌入图表 + 文字混排,用户看预览即可

## 何时**不**用

- 静态长文 → `markdown`
- 正式打印文档 → `pdf`
- PPT / 幻灯片 → `pptx`

## 工具

```
artifact_create({
  name: "<descriptive>.html",
  kind: "html",
  content: "<!doctype html>...",
  description: "<一句话>"
})
```

`content` 必须是完整 HTML 文档(`<!doctype html>` + `<html>` + `<head>` + `<body>`)。聊天里通过 sandboxed iframe 渲染,**不能依赖外部 JS / 字体 CDN**(用户可能离线,且 sandbox 屏蔽 cookie / parent navigation)。所有样式 + 数据内联在文档里。

## 设计契约 · 高级感

allhands 的产品视觉用 Brand Blue Dual Theme(ADR 0016)。HTML 制品要有同等水准 —— 不要 1995 年风格的灰底、Times New Roman、纯色按钮。**默认就是高大上。**

### 借鉴本项目 design tokens

| 元素 | 默认值 |
|---|---|
| 主色 | `#2563eb` (light) / `#60a5fa` (dark)· hover `#1d4ed8` / `#93c5fd` |
| 字体 | `-apple-system, "Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif` |
| 圆角 | 6 / 8 / 12 / 16 px(组件越大越圆) |
| 阴影 | `0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03)` 浅;`0 8px 24px rgba(0,0,0,.5)` 深 |
| 间距 | 8 / 12 / 16 / 24 / 32 px 网格 |
| 字号 | 11/12/13/14 (UI) · 16/18/20/24/32 (内容/标题) |
| 字重 | 400/500/600/700 |
| 圆角组件 hover | `transform: translateY(-1px); transition: 200ms;` |

### 必备样式骨架(放在 `<head>`)

```html
<style>
  :root {
    --bg: #fafbfc; --bg-2: #fff; --bg-3: #f3f5f8;
    --text: #1a1d23; --text-muted: #5b6472; --text-subtle: #8a93a3;
    --border: #e3e7ed; --border-strong: #cfd5de;
    --primary: #2563eb; --primary-hover: #1d4ed8;
    --primary-soft: #eef2ff;
    --shadow-sm: 0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03);
    --shadow-md: 0 4px 14px rgba(15,23,42,.06), 0 2px 4px rgba(15,23,42,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --bg-2: #161a22; --bg-3: #1d222c;
      --text: #e6e9ef; --text-muted: #9099a8; --text-subtle: #6c7585;
      --border: #262b35; --border-strong: #353b48;
      --primary: #60a5fa; --primary-hover: #93c5fd;
      --primary-soft: rgba(96,165,250,.12);
      --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
      --shadow-md: 0 8px 24px rgba(0,0,0,.5);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC",
                  "Microsoft YaHei", system-ui, sans-serif;
    background: var(--bg); color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
  h1 {
    font-size: 28px; font-weight: 700; letter-spacing: -.02em; margin: 0 0 8px;
    background: linear-gradient(135deg, var(--primary) 0%, #8b5cf6 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  h2 { font-size: 20px; margin: 32px 0 12px; letter-spacing: -.01em; }
  h3 { font-size: 15px; margin: 16px 0 8px; }
  .card {
    background: var(--bg-2); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px 24px;
    box-shadow: var(--shadow-sm); margin: 16px 0;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 4px;
    border-radius: 999px; padding: 2px 10px; font-size: 11px;
    border: 1px solid var(--border); background: var(--bg-3); color: var(--text-muted);
  }
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 8px; font: inherit; font-weight: 500;
    background: var(--primary); color: white; border: 0; cursor: pointer;
    transition: all 200ms ease;
  }
  .btn:hover { background: var(--primary-hover); transform: translateY(-1px); box-shadow: var(--shadow-md); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 600; background: var(--bg-3);
       font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
</style>
```

### 主标题用渐变文字

```html
<h1>季度业务回顾</h1>  <!-- 自动渐变 (蓝→紫) · 不需要额外 class -->
```

### 卡片网格

```html
<div class="card">
  <h3>关键指标</h3>
  <p>本季度 ARR 增长 <strong>+18%</strong>,客户数 <strong>1,240</strong>。</p>
</div>
```

### 数据可视化

简单图表用 SVG(没有外部依赖)。复杂动画 / 交互可以用纯原生 JS。**不要**引 chart.js / d3 / 任何 CDN。

## 内容大小

聊天里内联渲染上限大致 200 KB。超过就降级成可点击卡片(用户点开制品面板看)。**不要**为单页塞 5MB 的 base64 图。

## 常见坑

- ❌ 没 `<!doctype html>` → 老 Safari 进 quirks mode
- ❌ 没 `<meta charset="utf-8">` → 中文乱码
- ❌ 没 `<meta name="viewport" content="width=device-width,initial-scale=1">` → 手机看是缩小后的桌面版
- ❌ 用了 `position: fixed` → iframe 里行为奇怪
- ❌ 用 `localStorage` / `sessionStorage` → sandbox 不允许
- ❌ 引 `<script src="https://cdn..."></script>` → 离线 / sandbox 双重失败

## 完整示例:数据看板

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Q1 业务看板</title>
  <style>/* 上面的 :root + body + .card + 等等 */</style>
</head>
<body>
  <div class="wrap">
    <h1>Q1 业务看板</h1>
    <p style="color: var(--text-muted)">2026-01-01 ~ 2026-03-31</p>

    <div class="card">
      <h3>关键指标</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        <div><div style="color:var(--text-muted);font-size:12px">ARR</div>
             <div style="font-size:24px;font-weight:700">$2.4M</div></div>
        <div><div style="color:var(--text-muted);font-size:12px">客户数</div>
             <div style="font-size:24px;font-weight:700">1,240</div></div>
        <div><div style="color:var(--text-muted);font-size:12px">续约率</div>
             <div style="font-size:24px;font-weight:700">94%</div></div>
      </div>
    </div>
    <!-- 更多卡片 / 表格 / SVG 图表 ... -->
  </div>
</body>
</html>
```

记住:**默认就该有质感**。深浅自适配 · 渐变标题 · 卡片有阴影 · hover 微交互。这是用户对 allhands 制品的最低期望。

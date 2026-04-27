# All Hands · 组件代码片段

直接抄 · 都已经用 token 化的 CSS 变量(随主题切换)。

## Card · hairline + 阴影

```html
<div class="card">
  <h3>标题</h3>
  <p>正文。</p>
</div>
```

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  box-shadow: var(--shadow-sm);
  transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
}
.card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
  border-color: var(--border-strong);
}
```

## Pill · 微小标签(状态 / tag)

```html
<span class="pill primary">实时</span>
<span class="pill success">成功</span>
<span class="pill warning">警告</span>
```

```css
.pill {
  display: inline-flex; align-items: center; gap: 4px;
  border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 500;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted);
}
.pill.primary { color: var(--primary); background: var(--primary-soft); border-color: rgba(10,91,255,.3); }
.pill.success { color: var(--success); background: var(--success-soft); border-color: rgba(15,165,122,.3); }
.pill.warning { color: var(--warning); background: var(--warning-soft); border-color: rgba(217,119,6,.3); }
```

## Button · primary / ghost

```html
<button class="btn">主操作</button>
<button class="btn ghost">次操作</button>
```

```css
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 16px; border-radius: 8px;
  font: inherit; font-weight: 500; font-size: 13px;
  background: var(--primary); color: #fff; border: 0; cursor: pointer;
  transition: all 200ms ease; box-shadow: var(--shadow-sm);
}
.btn:hover { background: var(--primary-hover); transform: translateY(-1px); box-shadow: var(--shadow-glow); }
.btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--border); box-shadow: none; }
.btn.ghost:hover { border-color: var(--primary); color: var(--primary); transform: translateY(-1px); }
```

## Stat · 关键指标

```html
<div class="card stat">
  <div class="label">本月营收</div>
  <div class="value brand">¥2.4M</div>
  <div class="delta">+18% vs 上月</div>
</div>
```

```css
.stat .label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; }
.stat .value { font-size: 28px; font-weight: 700; margin-top: 4px; letter-spacing: -.02em;
               font-variant-numeric: tabular-nums; }
.stat .value.brand {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.stat .delta { font-size: 12px; color: var(--text-subtle); font-family: ui-monospace, monospace; margin-top: 2px; }
```

## Hero · 渐变标题 + tagline

```html
<section class="hero">
  <h1>__HERO_TITLE__</h1>
  <p class="tagline">__SUBTITLE__</p>
</section>
```

```css
h1 {
  font-size: 36px; font-weight: 700; letter-spacing: -.025em; margin: 0 0 8px;
  background: linear-gradient(135deg, var(--primary) 0%, #6366F1 50%, var(--accent) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.tagline { color: var(--text-muted); font-size: 15px; margin: 0; }
```

## Mesh hero · 暗主题专用大图标题背景

放在 hero section,让深主题有「光在透」感:

```css
@media (prefers-color-scheme: dark) {
  .hero { position: relative; overflow: hidden; }
  .hero::before {
    content: ""; position: absolute; inset: -40px; z-index: 0; pointer-events: none;
    background:
      radial-gradient(circle at 20% 30%, rgba(46,91,255,.25), transparent 45%),
      radial-gradient(circle at 80% 70%, rgba(110,139,255,.18), transparent 50%);
    filter: blur(40px);
  }
  .hero > * { position: relative; z-index: 1; }
}
```

## Hairline divider

```html
<hr class="hairline">
```

```css
.hairline { border: 0; border-top: 1px solid var(--border); margin: 36px 0; }
```

## Eyebrow · hero 上方小 label

```html
<span class="eyebrow">__EYEBROW__</span>
```

```css
.eyebrow {
  display: inline-block; padding: 4px 12px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text-muted); font-size: 11px; font-weight: 500;
  text-transform: uppercase; letter-spacing: .08em; margin-bottom: 16px;
}
```

## Bar · 横向进度条(数据排名)

```html
<div class="bar-row">
  <span class="name">A 产品</span>
  <span class="track"><span class="fill" style="width: 78%"></span></span>
  <span class="num">$2.4M</span>
</div>
```

```css
.bar-row { display: grid; grid-template-columns: 100px 1fr 60px;
           align-items: center; gap: 10px; padding: 6px 0;
           border-bottom: 1px solid var(--border); font-size: 13px; }
.bar-row .track { height: 6px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.bar-row .fill { height: 100%; background: linear-gradient(90deg, var(--primary), var(--accent));
                 border-radius: 999px; }
.bar-row .num { font-variant-numeric: tabular-nums; text-align: right; color: var(--text-muted);
                font-family: ui-monospace, monospace; font-size: 12px; }
```

## Sparkline · 内联 SVG 趋势线

```html
<svg class="spark" viewBox="0 0 400 100" preserveAspectRatio="none" style="width:100%;height:80px">
  <polyline fill="none" stroke="var(--primary)" stroke-width="2"
            points="0,80 50,72 100,60 150,55 200,40 250,35 300,28 350,20 400,18" />
</svg>
```

数据点 y 坐标越**小**线越**高**(SVG 坐标系 y 向下)。

## Glass panel · 半透明叠加(暗主题特别好看)

```css
.glass {
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
```

## Kbd · 键盘按键

```html
<span class="kbd">⌘</span> <span class="kbd">K</span>
```

```css
.kbd {
  font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11px;
  padding: 1px 6px; background: var(--surface-2);
  border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px;
}
```

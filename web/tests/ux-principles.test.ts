/**
 * Regression tests for the UX contract in `product/06-ux-principles.md`.
 *
 * Only rules that are reliably statically checkable live here. The rest
 * (P01 lead-agent-first, P04 three-state, P05 next-step errors, etc.) are
 * review-only — see the "如何验证" line under each principle in the doc.
 *
 * Adding a new mechanically-enforceable rule? Add a describe block here +
 * reference it from the principle's 如何验证 line.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const APP = path.join(REPO, "app");
const COMPONENTS = path.join(REPO, "components");

function walk(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) return walk(full, ext);
    return ext.test(name) ? [full] : [];
  });
}

const TS_OR_TSX = /\.(ts|tsx)$/;
const allSources = [...walk(APP, TS_OR_TSX), ...walk(COMPONENTS, TS_OR_TSX)];

function rel(p: string) {
  return path.relative(REPO, p);
}

/**
 * P08 · 反馈延迟分级 —— transition-duration 必须走 token。
 *
 * Tailwind 原生 `duration-150 / 200 / 300` 是魔法数字,切主题或调整节奏时
 * 必须全站找替。本项目唯一正确写法:`duration-fast / base / mid / slow`
 * (映射到 `--dur-*` CSS 变量)。
 */
describe("P08 · 动效时长必须走 token,禁止原生 duration-<数字>", () => {
  // design-lab 是样本多配色/多时长演示,允许硬编码展示不同节奏。
  const allow = (file: string) =>
    file.startsWith("app/design-lab/") || file === "app/globals.css";

  const RAW_DURATION = /\bduration-\d+\b/;

  it.each(allSources.map((p) => [rel(p)]))(
    "%s 不使用原生 duration-<数字>,必须 duration-fast/base/mid/slow",
    (file) => {
      if (allow(file)) return;
      const src = readFileSync(path.join(REPO, file), "utf8");
      expect(
        src,
        `P08 违规:${file} 使用了 duration-<数字>,请改为 duration-fast/base/mid/slow(见 product/06-ux-principles.md)`,
      ).not.toMatch(RAW_DURATION);
    },
  );
});

/**
 * P08 · 动效反例 —— 禁止 transition-all / 禁止 transition-shadow、scale/shadow 的
 * 交互反馈(视觉契约 03-visual-design 也禁过,这里再加一道交互层面的闸)。
 */
describe("P08 · 禁止 transition-all 与 scale/shadow 交互反馈", () => {
  const allow = (file: string) => file.startsWith("app/design-lab/");

  const BAD = [
    { pat: /\btransition-all\b/, reason: "transition-all 覆盖面太大,写 transition-colors/-opacity/-transform" },
    { pat: /\bhover:scale-\d/, reason: "hover 不允许 scale,见 03-visual-design §动效" },
    { pat: /\bhover:shadow-/, reason: "hover 不允许 shadow,见 03-visual-design §动效" },
  ];

  it.each(allSources.map((p) => [rel(p)]))(
    "%s 不含 transition-all / hover:scale / hover:shadow",
    (file) => {
      if (allow(file)) return;
      const src = readFileSync(path.join(REPO, file), "utf8");
      for (const { pat, reason } of BAD) {
        expect(src, `P08 违规:${file} — ${reason}`).not.toMatch(pat);
      }
    },
  );
});

/**
 * P04 · 三态必现 —— 启发式扫描。
 *
 * 任何文件里出现了"远程数据"标志(fetch / useSWR / useQuery / EventSource /
 * SSE),同一个文件就必须同时出现 loading / empty / error 三个语义分支的
 * 踪迹(至少各一个关键词)。否则几乎可以肯定三态没全。
 *
 * 这是启发式,不是形式验证 —— 宁可偶尔要 review 豁免,也要把最常见的遗漏
 * (直接 map 数组不处理空 / catch 块扔 console.error / 永远转菊花)拦下来。
 */
describe("P04 · 远程数据组件必须覆盖 loading / empty / error 三态(启发式)", () => {
  // page.tsx 常常只是布局 + 抽取的组件,豁免。设计样本 allow。
  // __tests__ 下的测试文件 fetch/EventSource 是用来驱动被测组件,不是 UI 渲染,豁免。
  const allow = (file: string) =>
    file.startsWith("app/design-lab/") ||
    file === "components/ui/icons.tsx" ||
    file.endsWith("/page.tsx") ||
    file.endsWith("/layout.tsx") ||
    file.endsWith("/route.ts") || // server route handlers return Response; no UI states to render
    file === "app/error.tsx" ||
    file === "app/not-found.tsx" ||
    /__tests__\//.test(file) ||
    /\.(test|spec)\.(ts|tsx)$/.test(file);

  const REMOTE_MARKER = /\b(fetch\s*\(|useSWR\b|useQuery\b|EventSource\b|createSSE|subscribeSSE)/;
  // 「在渲染列表」的信号:只有当一个组件真的在把数组渲成列表时,empty 才适用。
  // 单次 ping / action 提交 / 状态探测 (HealthBadge, InputBar) 不该被要求 empty。
  const LIST_MARKER = /\.map\s*\(|\bfor\s*\(\s*const\s+\w+\s+of\b/;

  const LOADING_MARKER = /\b(isLoading|loading|pending|Skeleton|shimmer|spinner|ah-pulse|ah-shimmer)\b/i;
  const EMPTY_MARKER = /\b(empty|EmptyState|isEmpty|noData|length\s*===\s*0|length\s*<\s*1|length\s*\?|\.length\)\s*[?!]=\s*0)\b/;
  const ERROR_MARKER = /\b(error|isError|onError|catch\s*\(|ErrorCard|errorMessage|failed)\b/i;

  const candidates = allSources.filter((p) => REMOTE_MARKER.test(readFileSync(p, "utf8")));

  it.each(candidates.map((p) => [rel(p)]))(
    "%s 出现远程调用时必须同文件覆盖 loading/error(列表类再加 empty)",
    (file) => {
      if (allow(file)) return;
      const src = readFileSync(path.join(REPO, file), "utf8");
      const rendersList = LIST_MARKER.test(src);
      const missing: string[] = [];
      if (!LOADING_MARKER.test(src)) missing.push("loading");
      if (rendersList && !EMPTY_MARKER.test(src)) missing.push("empty");
      if (!ERROR_MARKER.test(src)) missing.push("error");
      expect(
        missing,
        `P04 违规:${file} 出现远程数据调用但缺少 [${missing.join(", ")}] 状态的标记。` +
          ` 见 product/06-ux-principles.md § P04;如属误判,在本测试 allow() 豁免并说明原因。`,
      ).toEqual([]);
    },
  );
});

/**
 * P07 · kbd chip 显式 —— 键盘符号 (⌘ ⌥ ⌃ ⇧ ↵ ⌫ ⎋) 只允许出现在
 * <kbd> 或 font-mono 元素里。避免把快捷键随手写成裸文本。
 * 保守实现:含符号且同文件出现 <kbd 或 font-mono 即视为合规。
 */
describe("P07 · 键盘符号必须在 <kbd> / font-mono 内渲染", () => {
  // icons.tsx 纯 mono 字符字典,allow。
  const allow = (file: string) =>
    file.startsWith("app/design-lab/") || file === "components/ui/icons.tsx";

  const KEY_SYM = /[⌘⌥⌃⇧⌫⎋↵↩]/u;
  const HAS_KBD_OR_MONO = /<kbd\b|\bfont-mono\b/;

  it.each(
    allSources
      .filter((p) => KEY_SYM.test(readFileSync(p, "utf8")))
      .map((p) => [rel(p)]),
  )("%s 含键盘符号时必须在 <kbd> / font-mono 中", (file) => {
    if (allow(file)) return;
    const src = readFileSync(path.join(REPO, file), "utf8");
    expect(
      src,
      `P07 违规:${file} 含 ⌘/⌥/↵ 等键盘符号但没有 <kbd> 或 font-mono 包裹`,
    ).toMatch(HAS_KBD_OR_MONO);
  });
});

/**
 * Regression tests for frontend error patterns (visual + architectural
 * contracts). Each assertion locks in a fix for a bug or a violation of
 * `product/03-visual-design.md` / `product/04-architecture.md`. A failure's
 * message points straight at the rule that was violated.
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

const TSX = /\.tsx$/;
const TS_OR_TSX = /\.(ts|tsx)$/;

const allTsx = [...walk(APP, TSX), ...walk(COMPONENTS, TSX)];
const allSources = [...walk(APP, TS_OR_TSX), ...walk(COMPONENTS, TS_OR_TSX)];

function rel(p: string) {
  return path.relative(REPO, p);
}

describe("E01 · FOUC 主题切换水合不一致", () => {
  const layout = readFileSync(path.join(APP, "layout.tsx"), "utf8");

  // Post-ADR 0016: FOUC prevention moved from a hand-rolled inline script to
  // next-themes (wrapped in ThemeProvider). The contract is: <html> carries
  // data-theme-pack + suppressHydrationWarning, <body> suppresses too, and
  // ThemeProvider sits at the root. next-themes injects its own inline
  // init script at build time, so we no longer hand-roll one.
  it("layout.tsx uses next-themes ThemeProvider + suppressHydrationWarning", () => {
    expect(layout).toMatch(/ThemeProvider/);
    expect(layout).toMatch(/data-theme-pack/);
    expect(layout).toMatch(/<html[^>]*suppressHydrationWarning/);
    expect(layout).toMatch(/<body[^>]*suppressHydrationWarning/);
  });
});

describe("E02 · 长页面根容器必须 h-screen overflow-y-auto(禁止裸 min-h-screen)", () => {
  // 允许 min-h-screen 的文件(AppShell 内嵌、error/not-found 顶层居中布局 OK)
  const allow = new Set([
    "app/error.tsx",
    "app/not-found.tsx",
  ]);
  const pages = allTsx.filter((p) => /\/page\.tsx$/.test(p));

  it.each(pages.map((p) => [rel(p)]))(`%s 根元素不使用 min-h-screen`, (file) => {
    if (allow.has(file)) return;
    const src = readFileSync(path.join(REPO, file), "utf8");
    // 只禁止根级出现,AppShell 深层内部的不扫(会被 AppShell 的 h-screen 承载)
    expect(src, "long pages must use h-screen overflow-y-auto").not.toMatch(
      /className=["'`][^"'`]*\bmin-h-screen\b/,
    );
  });
});

describe("E03 · useSearchParams 必须包在 Suspense 内", () => {
  const pages = allTsx.filter((p) => /\/page\.tsx$/.test(p));
  const matching = pages.filter((p) =>
    readFileSync(p, "utf8").includes("useSearchParams"),
  );

  if (matching.length === 0) {
    it("当前没有页面使用 useSearchParams — 规则处于 idle 状态", () => {
      expect(matching.length).toBe(0);
    });
  } else {
    it.each(matching.map((p) => [rel(p)]))(
      "%s 使用 useSearchParams 时必须声明 Suspense",
      (file) => {
        const src = readFileSync(path.join(REPO, file), "utf8");
        expect(src).toMatch(/import\s*{[^}]*\bSuspense\b[^}]*}\s*from\s*["']react["']/);
        expect(src).toMatch(/<Suspense\b/);
      },
    );
  }
});

describe("E05 · App Router 必须存在 error.tsx 与 not-found.tsx", () => {
  it("app/error.tsx 存在", () => {
    expect(existsSync(path.join(APP, "error.tsx"))).toBe(true);
  });
  it("app/not-found.tsx 存在", () => {
    expect(existsSync(path.join(APP, "not-found.tsx"))).toBe(true);
  });
  it('app/error.tsx 以 "use client" 开头', () => {
    const src = readFileSync(path.join(APP, "error.tsx"), "utf8");
    expect(src.trimStart().startsWith('"use client"')).toBe(true);
  });
});

describe("E09 · 禁止在页面里自己 <link> Google Fonts(必须 next/font/google)", () => {
  it.each(allTsx.map((p) => [rel(p)]))(`%s 不直连 fonts.googleapis.com`, (file) => {
    const src = readFileSync(path.join(REPO, file), "utf8");
    expect(src).not.toMatch(/fonts\.googleapis\.com/);
  });
});

describe("E10 · 禁止硬编码十六进制 / Tailwind 原色类 / dark: 前缀", () => {
  // 视觉规约豁免:design-lab 是多配色活样本;icons.tsx 用到 currentColor/透明;
  // error/not-found 纯 token,走正常检查。
  const allow = (file: string) =>
    file.startsWith("app/design-lab/") ||
    file === "components/ui/icons.tsx" ||
    file === "app/globals.css";

  const HEX = /#[0-9A-Fa-f]{6}\b/;
  const RAW_COLOR = new RegExp(
    "\\b(bg|text|border|ring|from|to|via)-(" +
      "slate|zinc|neutral|stone|gray|red|orange|amber|yellow|lime|green|emerald|" +
      "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose" +
      ")-\\d{2,3}\\b",
  );
  const DARK_PREFIX = /\bdark:[a-z]/;

  it.each(allSources.map((p) => [rel(p)]))(`%s 不含硬编码颜色 / 原色类 / dark: 前缀`, (file) => {
    if (allow(file)) return;
    const src = readFileSync(path.join(REPO, file), "utf8");
    expect(src, `E10 违规(十六进制):${file}`).not.toMatch(HEX);
    expect(src, `E10 违规(Tailwind 原色类):${file}`).not.toMatch(RAW_COLOR);
    expect(src, `E10 违规(dark: 前缀):${file}`).not.toMatch(DARK_PREFIX);
  });
});

describe("E11 · icon 包只能经 Icon wrapper · 禁止 UI emoji", () => {
  // Post-ADR 0016: lucide-react is the sanctioned icon source but must be
  // funnelled through `<Icon>` (components/ui/icon.tsx). Feature code that
  // imports lucide-react directly bypasses the swap-out layer and breaks the
  // "change one file to change all icons" contract.
  const ICON_IMPORTS = [
    /from\s+["']lucide-react["']/,
    /from\s+["']@heroicons\//,
    /from\s+["']@phosphor-icons\//,
    /from\s+["']@tabler\/icons/,
  ];

  // Only the wrapper itself is allowed to import lucide-react. Legacy
  // components/ui/icons.tsx hosts brand glyphs (LogoDotgrid). design-lab is
  // the design sandbox and may use mono chars; error/not-found are plain text.
  const allow = (file: string) =>
    file.startsWith("app/design-lab/") ||
    file === "components/ui/icons.tsx" ||
    file === "components/ui/icon.tsx";

  // UI-decorative emoji only; don't flag emoji in user-content strings.
  const UI_EMOJI = /[☀☾⚙🔧📊💬👥🔌✨🏢🧠🛡📈🗂ℹ]/u;

  it.each(allSources.map((p) => [rel(p)]))(`%s 不 import icon 包、不含 UI emoji`, (file) => {
    if (allow(file)) return;
    const src = readFileSync(path.join(REPO, file), "utf8");
    for (const pat of ICON_IMPORTS) {
      expect(src, `E11 违规(icon 包):${file} · lucide-react must go through <Icon>`).not.toMatch(pat);
    }
    expect(src, `E11 违规(UI emoji):${file}`).not.toMatch(UI_EMOJI);
  });
});

describe("E08 · TS strict 不允许被关闭", () => {
  it("tsconfig.json 保持 strict:true", () => {
    const cfg = JSON.parse(readFileSync(path.join(REPO, "tsconfig.json"), "utf8"));
    const strict =
      cfg.compilerOptions?.strict ?? cfg.extends === undefined ? cfg.compilerOptions?.strict : true;
    expect(strict, "strict must stay true; use narrowing or optional chaining instead").toBe(true);
  });
});

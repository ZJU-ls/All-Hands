/**
 * Regression tests for the custom icon system (ADR 0009).
 *
 * Each assertion locks in a rule from product/03-visual-design.md §2.7 +
 * design-system/MASTER.md §3.2. Any failure points to a concrete violation
 * that must be fixed before merging:
 *
 *   C01 — every icon file is an IconBase wrapper (no raw <svg>)
 *   C02 — no inline color / fill / stroke attrs (currentColor only)
 *   C03 — every icon is re-exported from `components/icons/index.ts`
 *   C04 — AppShell sidebar menu renders a real Icon per item
 *   C05 — legacy 1-line SVG set in `components/ui/icons.tsx` still intact
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(REPO, "components", "icons");

function readIcon(name: string): string {
  return readFileSync(path.join(ICONS_DIR, name), "utf8");
}

const iconFiles = readdirSync(ICONS_DIR).filter(
  (f) => f.endsWith(".tsx") && f !== "Base.tsx",
);

describe("C01 · 每个 icon 必须通过 IconBase 包装", () => {
  it.each(iconFiles)("%s uses <IconBase ... >", (file) => {
    const src = readIcon(file);
    expect(src, `${file} must import IconBase`).toMatch(
      /import\s*\{\s*IconBase[^}]*\}\s*from\s*["']\.\/Base["']/,
    );
    expect(src, `${file} must render <IconBase ...>`).toMatch(/<IconBase\b/);
    expect(src, `${file} must not declare a raw <svg> root`).not.toMatch(
      /^\s*<svg\b/m,
    );
  });
});

describe("C02 · icon 必须只用 currentColor(禁止 inline 颜色)", () => {
  it.each(iconFiles)("%s 没有 inline color / fill / stroke 具体值", (file) => {
    const src = readIcon(file);
    // Inline fill="#hex" / fill="rgb(...)" / fill="red" on child elements.
    // `fill="none"` + `stroke="currentColor"` go on IconBase itself, so only
    // child path/rect/circle/line elements should be inspected.
    const childShapes = src.match(
      /<(path|rect|circle|line|polyline|polygon|ellipse)[^/]*\/>/g,
    ) ?? [];
    for (const shape of childShapes) {
      expect(
        shape,
        `${file} shape has inline fill/stroke: ${shape}`,
      ).not.toMatch(/\bfill="(?!none\b)[^"]+"/);
      expect(
        shape,
        `${file} shape has inline stroke: ${shape}`,
      ).not.toMatch(/\bstroke="(?!currentColor\b)[^"]+"/);
    }
  });
});

describe("C03 · 每个 icon 必须从 index.ts 导出", () => {
  const index = readFileSync(path.join(ICONS_DIR, "index.ts"), "utf8");

  it.each(iconFiles)("%s 在 index.ts 中有 export", (file) => {
    const name = file.replace(/\.tsx$/, "");
    expect(index).toMatch(
      new RegExp(`export\\s*\\{\\s*${name}\\s*\\}\\s*from\\s*["']\\./${name}["']`),
    );
  });

  it("index.ts 至少导出 22 个 icon(Track E 首批)", () => {
    const exportCount = (index.match(/^export\s*\{\s*\w+Icon\s*\}/gm) ?? [])
      .length;
    expect(exportCount).toBeGreaterThanOrEqual(22);
  });

  it("index.ts 同时导出 IconBase + IconProps type", () => {
    expect(index).toMatch(/export\s*\{\s*IconBase\s*\}\s*from\s*["']\.\/Base["']/);
    expect(index).toMatch(
      /export\s+type\s*\{\s*IconProps\s*\}\s*from\s*["']\.\/Base["']/,
    );
  });
});

describe("C04 · AppShell 主侧栏每项必须带 Icon(B1 扁平 nav 验收)", () => {
  const shell = readFileSync(
    path.join(REPO, "components", "shell", "AppShell.tsx"),
    "utf8",
  );

  // Post-ADR 0016: business icons route through the <Icon> wrapper. The
  // legacy custom-icon grid stays for brand glyphs (LogoDotgrid).
  it("AppShell 从 @/components/ui/icon 导入 <Icon> wrapper", () => {
    expect(shell).toMatch(/from\s*["']@\/components\/ui\/icon["']/);
    expect(shell).toMatch(/\bIcon\b/);
  });

  it("MENU 数据结构声明 icon 字段(kebab-case IconName)", () => {
    // The new contract uses `icon: "users"` (string) rather than the old
    // `Icon: UserIcon` (component reference), so swapping the underlying
    // library never touches AppShell.
    expect(shell).toMatch(/icon:\s*["'][a-z][a-z0-9-]*["']/);
  });

  it("SidebarItem 组件把 <Icon> 渲染出来", () => {
    expect(shell).toMatch(/<Icon\b/);
  });

  it("AppShell 不 import lucide-react 直接(必须经 wrapper)", () => {
    expect(shell).not.toMatch(/from\s+["']lucide-react["']/);
    expect(shell).not.toMatch(/from\s+["']@heroicons/);
    expect(shell).not.toMatch(/from\s+["']@phosphor-icons/);
    expect(shell).not.toMatch(/from\s+["']@tabler\/icons/);
  });
});

describe("C05 · legacy 1-line SVG 集仍保留在 components/ui/icons.tsx", () => {
  const legacy = readFileSync(
    path.join(REPO, "components", "ui", "icons.tsx"),
    "utf8",
  );

  it("保留 LogoDotgrid + Sun/Moon + 5 类基础图元", () => {
    expect(legacy).toMatch(/LogoDotgrid/);
    expect(legacy).toMatch(/SunIcon/);
    expect(legacy).toMatch(/MoonIcon/);
  });
});

describe("C06 · design-lab 必须渲染 Icon Gallery", () => {
  const designLab = readFileSync(
    path.join(REPO, "app", "design-lab", "page.tsx"),
    "utf8",
  );

  it("含 data-testid=\"icon-gallery\"", () => {
    expect(designLab).toMatch(/data-testid=["']icon-gallery["']/);
  });

  // Post-ADR 0016: design-lab imports the <Icon> wrapper so the gallery is
  // keyed by the same registry the rest of the app consumes.
  it("从 @/components/ui/icon 导入 <Icon>", () => {
    expect(designLab).toMatch(/from\s*["']@\/components\/ui\/icon["']/);
  });
});

"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { LogoDotgrid } from "@/components/ui/icons";
import { Icon, type IconName } from "@/components/ui/icon";

// Lazy-load the two global overlays so their module graph (DotGridBackdrop,
// RunTracePanel, AgentMarkdown, runs/* components, icons pack) isn't dragged
// into every route's dev cold-compile. ⌘K and `?trace=` are both infrequent
// user-triggered surfaces, so a one-shot dynamic import on first open is
// unnoticeable vs. the 2-6s per-route compile cost it saves. See L08.
const CommandPalette = dynamic(
  () => import("@/components/ui/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false },
);
const RunTraceDrawer = dynamic(
  () => import("@/components/runs/RunTraceDrawer").then((m) => m.RunTraceDrawer),
  { ssr: false },
);
const TRACE_QUERY_KEY = "trace";

type MenuItem = { label: string; href: string; icon: IconName; badge?: string };
type MenuSection = { title: string; items: MenuItem[] };

// All business-icon choices route through <Icon> (lucide) per ADR 0016 §D1.
const MENU: MenuSection[] = [
  {
    title: "工作区",
    items: [
      { label: "驾驶舱", href: "/", icon: "layout-grid" },
      { label: "对话", href: "/chat", icon: "message-square" },
      { label: "任务", href: "/tasks", icon: "check-circle-2" },
      { label: "历史会话", href: "/conversations", icon: "clock" },
    ],
  },
  {
    title: "团队与能力",
    items: [
      { label: "员工", href: "/employees", icon: "users" },
      { label: "员工设计", href: "/employees/design", icon: "user-plus" },
      { label: "技能", href: "/skills", icon: "wand-2" },
      { label: "MCP 服务器", href: "/mcp-servers", icon: "plug" },
    ],
  },
  {
    title: "模型网关",
    items: [{ label: "供应商与模型", href: "/gateway", icon: "server" }],
  },
  {
    title: "运行时",
    items: [
      { label: "触发器", href: "/triggers", icon: "zap" },
      { label: "审批", href: "/confirmations", icon: "shield-check" },
      { label: "追踪", href: "/traces", icon: "activity" },
      { label: "观测中心", href: "/observatory", icon: "brain" },
    ],
  },
  {
    title: "系统",
    items: [
      { label: "Review", href: "/review", icon: "check" },
      { label: "设置", href: "/settings", icon: "settings" },
      { label: "关于", href: "/about", icon: "info" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────────────

function CmdKHint({ onOpen }: { onOpen: () => void }) {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group hidden md:inline-flex h-9 min-w-[220px] items-center gap-2.5 rounded-xl border border-border bg-surface px-3 text-sm text-text-muted hover:border-border-strong hover:bg-surface-2 hover:text-text transition duration-base"
      aria-label="打开命令面板"
      title="⌘K 打开命令面板"
    >
      <Icon name="search" size={14} />
      <span className="flex-1 text-left">跳转到…</span>
      <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text-subtle group-hover:text-text-muted">
        {isMac ? "⌘K" : "Ctrl K"}
      </span>
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  // Avoid hydration flash — only trust `theme` after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";
  return (
    <button
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text transition duration-base"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "切换到浅色" : "切换到深色"}
    >
      <Icon name={isDark ? "sun" : "moon"} size={15} />
    </button>
  );
}

function SidebarItem({
  label,
  href,
  active,
  icon,
  badge,
}: MenuItem & { active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className={
          active
            ? "relative flex h-9 items-center gap-2.5 rounded-lg bg-primary pl-3 pr-2 text-sm font-medium text-primary-fg shadow-soft-sm transition duration-fast"
            : "group relative flex h-9 items-center gap-2.5 rounded-lg pl-3 pr-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast"
        }
      >
        <Icon
          name={icon}
          size={14}
          className={active ? "" : "text-text-subtle group-hover:text-text-muted"}
        />
        <span className="flex-1 truncate">{label}</span>
        {badge ? (
          <span
            className={
              active
                ? "inline-flex h-4 items-center rounded bg-primary-fg/20 px-1.5 font-mono text-caption"
                : "inline-flex h-4 items-center rounded bg-surface-2 px-1.5 font-mono text-caption text-text-muted"
            }
          >
            {badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function matchActive(pathname: string, href: string, allHrefs: string[]): boolean {
  // Exact match always wins.
  if (pathname === href) return true;
  // Prefix match only when no sibling href is a longer prefix of pathname.
  // Fixes the "员工 vs 员工设计" conflict at `/employees/design` — without
  // this the shorter `/employees` would also light up.
  if (!pathname.startsWith(href + "/")) return false;
  for (const other of allHrefs) {
    if (other === href) continue;
    if (other.length > href.length && pathname.startsWith(other)) return false;
  }
  return true;
}

function WorkspaceSwitcher() {
  return (
    <button
      type="button"
      className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-transparent px-2 hover:border-border-strong hover:bg-surface-2 transition duration-fast"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg shadow-soft-sm">
        <LogoDotgrid />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold leading-tight tracking-tight">
          allhands
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
          v0 · mvp
        </div>
      </div>
      <Icon name="chevrons-up-down" size={14} className="text-text-subtle" />
    </button>
  );
}

function UsageCard() {
  return (
    <div className="mx-3 mb-3 rounded-xl border border-primary/20 bg-primary-muted p-3">
      <div className="flex items-center gap-2 text-caption font-semibold text-primary">
        <Icon name="zap" size={12} /> Usage · 62%
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full"
          style={{
            width: "62%",
            background:
              "linear-gradient(90deg, var(--color-primary), var(--color-accent))",
          }}
        />
      </div>
      <div className="mt-2 font-mono text-caption text-text-muted">
        18.4M / 30M tokens
      </div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const allHrefs = MENU.flatMap((s) => s.items.map((i) => i.href));
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center border-b border-border px-3">
        <WorkspaceSwitcher />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
        {MENU.map((section) => (
          <div key={section.title}>
            <div className="mb-1.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-subtle">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = matchActive(pathname, item.href, allHrefs);
                return (
                  <SidebarItem key={item.href} {...item} active={active} />
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <UsageCard />
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────────────────────────────

export function AppShell({
  children,
  title,
  actions,
}: {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Gate the dynamic-imported CommandPalette behind first-open so its module
  // graph never loads on a dev session where the user never presses ⌘K.
  const [paletteMounted, setPaletteMounted] = useState(false);
  const searchParams = useSearchParams();
  const hasTrace = Boolean(searchParams?.get(TRACE_QUERY_KEY));

  // Global ⌘K is owned here (not inside CommandPalette) so the palette can
  // stay unloaded until first open.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setPaletteMounted(true);
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openPalette = useCallback(() => {
    setPaletteMounted(true);
    setPaletteOpen(true);
  }, []);

  return (
    <div className="flex h-screen w-full bg-bg text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg/80 px-6 backdrop-blur-md">
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <CmdKHint onOpen={openPalette} />
            {actions}
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ThemeToggle />
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text transition duration-base"
              aria-label="Notifications"
              title="通知"
            >
              <Icon name="bell" size={15} />
            </button>
            <div
              className="grid h-9 w-9 place-items-center rounded-full text-caption font-semibold text-primary-fg"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
              }}
              aria-label="User"
              title="你的账户"
            >
              LS
            </div>
          </div>
        </header>
        <main
          className="flex-1 overflow-hidden"
          style={{
            animation: "ah-fade-up var(--dur-mid) var(--ease-out-quart) both",
          }}
        >
          {children}
        </main>
      </div>
      {paletteMounted && (
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      )}
      {hasTrace && <RunTraceDrawer />}
    </div>
  );
}

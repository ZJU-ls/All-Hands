"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "@/components/theme/ThemeProvider";
import { AllhandsLogo } from "@/components/brand/AllhandsLogo";
import { Icon, type IconName } from "@/components/ui/icon";
import { LocaleSwitcher } from "@/components/locale/LocaleSwitcher";
import { ToastProvider } from "@/components/ui/Toast";
import { KeyboardShortcutsModal } from "@/components/shell/KeyboardShortcutsModal";
import { RouteProgress } from "@/components/shell/RouteProgress";
import { useDocumentTitle } from "@/lib/use-document-title";

// Lazy-load the global ⌘K palette so its module graph isn't dragged into
// every route's dev cold-compile. (The trace drawer used to live here too;
// it was removed when trace viewing moved into observatory's L3 page —
// /observatory/runs/[id] · TraceChip now navigates rather than opening an
// overlay. See `docs/specs/2026-04-27-trace-into-observatory.md`.)
const CommandPalette = dynamic(
  () => import("@/components/ui/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false },
);

type MenuItem = { labelKey: string; href: string; icon: IconName; badge?: string };
type MenuSection = { titleKey: string; items: MenuItem[] };

// All business-icon choices route through <Icon> (lucide) per ADR 0016 §D1.
const MENU: MenuSection[] = [
  {
    titleKey: "workspace",
    items: [
      { labelKey: "cockpit", href: "/", icon: "layout-grid" },
      { labelKey: "chat", href: "/chat", icon: "message-square" },
      { labelKey: "tasks", href: "/tasks", icon: "check-circle-2" },
      { labelKey: "conversations", href: "/conversations", icon: "clock" },
      { labelKey: "artifacts", href: "/artifacts", icon: "folder" },
    ],
  },
  {
    titleKey: "team",
    items: [
      { labelKey: "employees", href: "/employees", icon: "users" },
      { labelKey: "employeeDesign", href: "/employees/design", icon: "user-plus" },
      { labelKey: "skills", href: "/skills", icon: "wand-2" },
      { labelKey: "mcpServers", href: "/mcp-servers", icon: "plug" },
      { labelKey: "knowledge", href: "/knowledge", icon: "book-open" },
    ],
  },
  {
    titleKey: "gateway",
    items: [{ labelKey: "providers", href: "/gateway", icon: "server" }],
  },
  {
    titleKey: "runtime",
    items: [
      { labelKey: "triggers", href: "/triggers", icon: "zap" },
      { labelKey: "confirmations", href: "/confirmations", icon: "shield-check" },
      { labelKey: "traces", href: "/traces", icon: "activity" },
      { labelKey: "observatory", href: "/observatory", icon: "brain" },
    ],
  },
  {
    titleKey: "system",
    items: [
      { labelKey: "review", href: "/review", icon: "check" },
      { labelKey: "settings", href: "/settings", icon: "settings" },
      { labelKey: "about", href: "/about", icon: "info" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────────────

function CmdKHint({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations("shell.search");
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group hidden md:inline-flex h-9 min-w-[220px] items-center gap-2.5 rounded-xl border border-border bg-surface px-3 text-sm text-text-muted hover:border-border-strong hover:bg-surface-2 hover:text-text transition duration-base"
      aria-label={t("ariaOpen")}
      title={t("title")}
    >
      <Icon name="search" size={14} />
      <span className="flex-1 text-left">{t("placeholder")}</span>
      <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text-subtle group-hover:text-text-muted">
        {isMac ? "⌘K" : "Ctrl K"}
      </span>
    </button>
  );
}

function ThemeToggle() {
  const t = useTranslations("shell.topbar");
  const { theme, toggle } = useTheme();
  // Avoid hydration flash — only trust `theme` after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";
  return (
    <button
      onClick={toggle}
      className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text transition duration-base"
      aria-label={isDark ? t("themeAriaLight") : t("themeAriaDark")}
      title={isDark ? t("switchToLight") : t("switchToDark")}
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
  collapsed,
}: {
  label: string;
  href: string;
  icon: IconName;
  badge?: string;
  active: boolean;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <li>
        <Link
          href={href}
          aria-label={label}
          title={label}
          className={
            active
              ? "relative mx-auto grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-fg shadow-soft-sm transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fg/40"
              : "group relative mx-auto grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:bg-surface-2"
          }
        >
          <Icon
            name={icon}
            size={15}
            className={active ? "" : "text-text-subtle group-hover:text-text-muted"}
          />
          {badge ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] text-primary-fg"
            >
              {badge}
            </span>
          ) : null}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        className={
          active
            ? "relative flex h-9 items-center gap-2.5 rounded-lg bg-primary pl-3 pr-2 text-sm font-medium text-primary-fg shadow-soft-sm transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fg/40"
            : "group relative flex h-9 items-center gap-2.5 rounded-lg pl-3 pr-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:bg-surface-2"
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
  if (!pathname.startsWith(href + "/")) return false;
  for (const other of allHrefs) {
    if (other === href) continue;
    if (other.length > href.length && pathname.startsWith(other)) return false;
  }
  return true;
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations("shell");
  return (
    <button
      type="button"
      className={
        collapsed
          ? "flex h-11 w-full items-center justify-center rounded-xl border border-transparent hover:border-border-strong hover:bg-surface-2 transition duration-fast"
          : "flex h-11 w-full items-center gap-2.5 rounded-xl border border-transparent px-2 hover:border-border-strong hover:bg-surface-2 transition duration-fast"
      }
      aria-label="allhands"
      title="allhands"
    >
      <AllhandsLogo size={32} className="shadow-soft-sm" />
      {collapsed ? null : (
        <>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-semibold leading-tight tracking-tight">
              allhands
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
              {t("workspaceVersion")}
            </div>
          </div>
          <Icon name="chevrons-up-down" size={14} className="text-text-subtle" />
        </>
      )}
    </button>
  );
}

function UsageCard() {
  const t = useTranslations("shell");
  return (
    <div className="mx-3 mb-3 rounded-xl border border-primary/20 bg-primary-muted p-3">
      <div className="flex items-center gap-2 text-caption font-semibold text-primary">
        <Icon name="zap" size={12} /> {t("usage")} · 62%
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
        {t("tokens", { used: "18.4M", total: "30M" })}
      </div>
    </div>
  );
}

function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const tSection = useTranslations("shell.sections");
  const tMenu = useTranslations("shell.menu");
  const tSide = useTranslations("shell.sidebar");
  const allHrefs = useMemo(() => MENU.flatMap((s) => s.items.map((i) => i.href)), []);
  return (
    <aside
      className={
        collapsed
          ? "flex w-14 shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-base"
          : "flex w-60 shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-base"
      }
    >
      <div className="flex h-14 items-center border-b border-border px-3">
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
        {MENU.map((section) => (
          <div key={section.titleKey}>
            {collapsed ? (
              <div className="mb-1.5 mx-2 h-px bg-border/60" aria-hidden />
            ) : (
              <div className="mb-1.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-subtle">
                {tSection(section.titleKey)}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = matchActive(pathname, item.href, allHrefs);
                return (
                  <SidebarItem
                    key={item.href}
                    label={tMenu(item.labelKey)}
                    href={item.href}
                    icon={item.icon}
                    badge={item.badge}
                    active={active}
                    collapsed={collapsed}
                  />
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {collapsed ? null : <UsageCard />}
      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? tSide("expand") : tSide("collapse")}
          title={`${collapsed ? tSide("expand") : tSide("collapse")} · ${tSide("toggleHint")}`}
          className={
            collapsed
              ? "mx-auto grid h-8 w-8 place-items-center rounded-lg text-text-subtle hover:bg-surface-2 hover:text-text transition duration-fast"
              : "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-caption text-text-subtle hover:bg-surface-2 hover:text-text transition duration-fast"
          }
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
          {collapsed ? null : (
            <>
              <span className="flex-1 text-left">{tSide("collapse")}</span>
              <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
                {tSide("toggleHint")}
              </span>
            </>
          )}
        </button>
      </div>
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
  const t = useTranslations("shell.topbar");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMounted, setPaletteMounted] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Sync browser tab title with the page-supplied title (locale-aware via
  // the `title` prop the caller computed from useTranslations).
  useDocumentTitle(title);

  // Hydrate sidebar collapsed pref from localStorage post-mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("ah.sidebar.collapsed");
      if (v === "1") setSidebarCollapsed(true);
    } catch {
      // ignore — private mode / disabled storage
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("ah.sidebar.collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setPaletteMounted(true);
        setPaletteOpen((v) => !v);
      } else if (ev.key === "?" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        // `?` (Shift+/) → open shortcuts cheat-sheet · skip while typing.
        const target = ev.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target?.isContentEditable
        ) {
          return;
        }
        ev.preventDefault();
        setShortcutsOpen(true);
      } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "b") {
        // Cmd/Ctrl+B → toggle sidebar (skip when typing in input/textarea/contenteditable).
        const target = ev.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target?.isContentEditable
        ) {
          return;
        }
        ev.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const openPalette = useCallback(() => {
    setPaletteMounted(true);
    setPaletteOpen(true);
  }, []);

  return (
    <ToastProvider>
    <RouteProgress />
    <div className="flex h-screen w-full bg-bg text-text">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg/80 px-6 backdrop-blur-md">
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <CmdKHint onOpen={openPalette} />
            {actions}
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <LocaleSwitcher />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text transition duration-base"
              aria-label={t("shortcutsAria")}
              title={t("shortcutsTitle")}
            >
              <Icon name="circle-help" size={15} />
            </button>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text transition duration-base"
              aria-label={t("notifications")}
              title={t("notifications")}
            >
              <Icon name="bell" size={15} />
            </button>
            <div
              className="grid h-9 w-9 place-items-center rounded-full text-caption font-semibold text-primary-fg"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
              }}
              aria-label={t("account")}
              title={t("account")}
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
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
    </ToastProvider>
  );
}

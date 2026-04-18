"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/theme/ThemeProvider";
import { LogoDotgrid, SunIcon, MoonIcon } from "@/components/ui/icons";

type MenuItem = { label: string; href: string };
type MenuSection = { title: string; items: MenuItem[] };

const MENU: MenuSection[] = [
  {
    title: "工作区",
    items: [
      { label: "对话", href: "/chat" },
      { label: "历史会话", href: "/conversations" },
    ],
  },
  {
    title: "团队与能力",
    items: [
      { label: "员工", href: "/employees" },
      { label: "技能", href: "/skills" },
      { label: "MCP 服务器", href: "/mcp-servers" },
    ],
  },
  {
    title: "模型网关",
    items: [{ label: "供应商与模型", href: "/gateway" }],
  },
  {
    title: "运行时",
    items: [
      { label: "触发器", href: "/triggers" },
      { label: "审批", href: "/confirmations" },
      { label: "追踪", href: "/traces" },
    ],
  },
  {
    title: "系统",
    items: [
      { label: "设置", href: "/settings" },
      { label: "关于", href: "/about" },
    ],
  },
];

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:text-text hover:bg-surface-2 hover:border-border-strong transition-colors duration-base"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "切换到浅色" : "切换到深色"}
    >
      {isDark ? <SunIcon size={14} /> : <MoonIcon size={14} />}
    </button>
  );
}

function SidebarItem({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className={`relative flex items-center h-7 px-3 text-[12px] transition-colors duration-base ${
          active
            ? "text-text font-medium"
            : "text-text-muted hover:text-text"
        }`}
      >
        {active && (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
            style={{
              animation: "ah-bar-in 180ms var(--ease-out) both",
              transformOrigin: "center",
            }}
            aria-hidden="true"
          />
        )}
        <span>{label}</span>
      </Link>
    </li>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="h-11 flex items-center px-4 gap-2 border-b border-border">
        <LogoDotgrid />
        <span className="text-[13px] font-semibold tracking-tight text-text">allhands</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {MENU.map((section) => (
          <div key={section.title} className="mb-2">
            <div className="px-3 mt-3 mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-subtle">
              {section.title}
            </div>
            <ul>
              {section.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <SidebarItem
                    key={item.href}
                    label={item.label}
                    href={item.href}
                    active={active}
                  />
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-4 py-2 font-mono text-[10px] text-text-subtle">
        v0 · MVP
      </div>
    </aside>
  );
}

export function AppShell({
  children,
  title,
  actions,
}: {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full bg-bg text-text">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-11 shrink-0 border-b border-border flex items-center justify-between px-6">
          <h1 className="text-[13px] font-semibold tracking-tight">{title}</h1>
          <div className="flex items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/theme/ThemeProvider";
import { LogoDotgrid, SunIcon, MoonIcon } from "@/components/ui/icons";
import {
  ChatIcon,
  CockpitIcon,
  UserIcon,
  SkillIcon,
  ModelIcon,
  PluginIcon,
  TriggerIcon,
  TaskIcon,
  ObservatoryIcon,
  CheckIcon,
  SettingsIcon,
  ExternalIcon,
  type IconProps,
} from "@/components/icons";

type IconComp = (props: IconProps) => JSX.Element;
type MenuItem = { label: string; href: string; Icon: IconComp };
type MenuSection = { title: string; items: MenuItem[] };

const MENU: MenuSection[] = [
  {
    title: "工作区",
    items: [
      { label: "驾驶舱", href: "/", Icon: CockpitIcon },
      { label: "对话", href: "/chat", Icon: ChatIcon },
      { label: "任务", href: "/tasks", Icon: TaskIcon },
      { label: "历史会话", href: "/conversations", Icon: ChatIcon },
    ],
  },
  {
    title: "团队与能力",
    items: [
      { label: "员工", href: "/employees", Icon: UserIcon },
      { label: "员工设计", href: "/employees/design", Icon: UserIcon },
      { label: "技能", href: "/skills", Icon: SkillIcon },
      { label: "MCP 服务器", href: "/mcp-servers", Icon: PluginIcon },
    ],
  },
  {
    title: "模型网关",
    items: [{ label: "供应商与模型", href: "/gateway", Icon: ModelIcon }],
  },
  {
    title: "运行时",
    items: [
      { label: "触发器", href: "/triggers", Icon: TriggerIcon },
      { label: "审批", href: "/confirmations", Icon: CheckIcon },
      { label: "追踪", href: "/traces", Icon: ExternalIcon },
      { label: "观测中心", href: "/observatory", Icon: ObservatoryIcon },
    ],
  },
  {
    title: "系统",
    items: [
      { label: "Review", href: "/review", Icon: CheckIcon },
      { label: "设置", href: "/settings", Icon: SettingsIcon },
      { label: "关于", href: "/about", Icon: SettingsIcon },
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

function SidebarItem({
  label,
  href,
  active,
  Icon,
}: {
  label: string;
  href: string;
  active: boolean;
  Icon: IconComp;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`relative flex items-center h-8 pl-5 pr-3 gap-2.5 text-[12px] transition-colors duration-base ${
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
        <Icon size={16} className={active ? "text-text" : "text-text-muted"} />
        <span className="truncate">{label}</span>
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

function Sidebar() {
  const pathname = usePathname();
  const allHrefs = MENU.flatMap((s) => s.items.map((i) => i.href));
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="h-11 flex items-center px-4 gap-2 border-b border-border">
        <LogoDotgrid />
        <span className="text-[13px] font-semibold tracking-tight text-text">allhands</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {MENU.map((section) => (
          <div key={section.title} className="mb-2">
            <div className="px-5 mt-3 mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-subtle">
              {section.title}
            </div>
            <ul>
              {section.items.map((item) => {
                const active = matchActive(pathname, item.href, allHrefs);
                return (
                  <SidebarItem
                    key={item.href}
                    label={item.label}
                    href={item.href}
                    Icon={item.Icon}
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

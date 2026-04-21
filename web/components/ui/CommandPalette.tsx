"use client";

/**
 * CommandPalette · ⌘K route jump · Linear Precise
 *
 * Minimal v0:
 * - Opens on ⌘K / Ctrl+K anywhere in the app (also unopens).
 * - Fuzzy substring match over route list (label + href).
 * - Arrow keys navigate, Enter opens, Esc closes.
 * - Visual: rounded-xl border card, ah-fade-up entrance, dotgrid backdrop
 *   behind the input for the "Linear / Raycast" silhouette.
 *
 * Wire once at AppShell. Routes are hard-coded here; when the product
 * grows this can move to a registry with each feature declaring entries.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  SettingsIcon,
  CheckIcon,
  SearchIcon,
  MarketIcon,
  ChannelIcon,
  StockIcon,
  ExternalIcon,
  type IconProps,
} from "@/components/icons";
import { DotGridBackdrop } from "./DotGridBackdrop";

type IconComp = (p: IconProps) => JSX.Element;
type Entry = {
  label: string;
  href: string;
  hint: string;
  Icon: IconComp;
  keywords?: string;
};

const ENTRIES: Entry[] = [
  { label: "驾驶舱", href: "/", hint: "workspace snapshot", Icon: CockpitIcon, keywords: "home dashboard cockpit" },
  { label: "对话", href: "/chat", hint: "chat with lead", Icon: ChatIcon, keywords: "chat lead" },
  { label: "历史会话", href: "/conversations", hint: "past conversations", Icon: ChatIcon, keywords: "history conversations" },
  { label: "任务", href: "/tasks", hint: "async tasks", Icon: TaskIcon, keywords: "tasks jobs async" },
  { label: "员工", href: "/employees", hint: "digital employees", Icon: UserIcon, keywords: "employees agents team" },
  { label: "员工设计", href: "/employees/design", hint: "design new employee", Icon: UserIcon, keywords: "employee design new" },
  { label: "技能", href: "/skills", hint: "skill packs", Icon: SkillIcon, keywords: "skills abilities prompts" },
  { label: "MCP 服务器", href: "/mcp-servers", hint: "external mcp", Icon: PluginIcon, keywords: "mcp plugins servers" },
  { label: "供应商与模型", href: "/gateway", hint: "provider + model gateway", Icon: ModelIcon, keywords: "gateway llm provider model openai anthropic" },
  { label: "技能市场", href: "/market", hint: "browse skill market", Icon: MarketIcon, keywords: "market skills browse install" },
  { label: "触发器", href: "/triggers", hint: "scheduled + webhook", Icon: TriggerIcon, keywords: "triggers cron webhook schedule" },
  { label: "通知渠道", href: "/channels", hint: "slack email webhook", Icon: ChannelIcon, keywords: "channels notifications slack email webhook" },
  { label: "审批", href: "/confirmations", hint: "pending approvals", Icon: CheckIcon, keywords: "confirmations approvals gate" },
  { label: "追踪", href: "/traces", hint: "langfuse traces", Icon: ExternalIcon, keywords: "traces observability langfuse" },
  { label: "观测中心", href: "/observatory", hint: "platform observability", Icon: ObservatoryIcon, keywords: "observatory metrics dashboard" },
  { label: "股票助手", href: "/stock-assistant", hint: "market anomaly demo", Icon: StockIcon, keywords: "stock market demo" },
  { label: "Review", href: "/review", hint: "agent review", Icon: CheckIcon, keywords: "review approvals" },
  { label: "设置", href: "/settings", hint: "system settings", Icon: SettingsIcon, keywords: "settings config" },
  { label: "关于", href: "/about", hint: "about allhands", Icon: SettingsIcon, keywords: "about version" },
];

function fuzzyMatch(q: string, e: Entry): number {
  if (!q) return 1;
  const needle = q.toLowerCase();
  const hay = `${e.label} ${e.href} ${e.hint} ${e.keywords ?? ""}`.toLowerCase();
  if (hay.includes(needle)) return 2;
  // Loose: every char in needle appears in hay in order.
  let i = 0;
  for (const c of hay) {
    if (c === needle[i]) i += 1;
    if (i === needle.length) return 1;
  }
  return 0;
}

export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
}: {
  /** Optional controlled open state. When omitted, the component manages it
   * internally and still responds to ⌘K globally. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolve = (prev: boolean) =>
        typeof next === "function" ? (next as (p: boolean) => boolean)(prev) : next;
      if (isControlled) {
        onOpenChange?.(resolve(open));
      } else {
        setUncontrolledOpen((prev) => {
          const v = resolve(prev);
          onOpenChange?.(v);
          return v;
        });
      }
    },
    [isControlled, onOpenChange, open],
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const scored = ENTRIES.map((e) => ({ e, score: fuzzyMatch(query, e) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ e }) => e);
    return scored;
  }, [query]);

  // ⌘K is owned by AppShell so the palette module can stay lazy-loaded until
  // first open; this effect only handles Escape-to-close while mounted-and-open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const pick = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen],
  );

  const onListKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const target = filtered[active];
        if (target) {
          e.preventDefault();
          pick(target.href);
        }
      }
    },
    [filtered, active, pick],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="命令面板"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-[15vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-xl rounded-xl border border-border bg-surface overflow-hidden"
        style={{ animation: "ah-fade-up 220ms var(--ease-out) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <DotGridBackdrop opacity={0.25} />
        <div className="relative flex items-center gap-2 px-4 py-3 border-b border-border">
          <SearchIcon size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onListKey}
            placeholder="跳转到页面 · 搜索员工 · 技能 · 模型"
            className="flex-1 bg-transparent outline-none text-[14px] text-text placeholder-text-subtle"
          />
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface-2 text-text-muted">
            Esc
          </span>
        </div>
        <ul className="relative max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-[12px] text-text-muted">
              没有匹配的入口 · 试试别的关键词
            </li>
          ) : (
            filtered.map((e, i) => {
              const isActive = i === active;
              return (
                <li key={e.href}>
                  <Link
                    href={e.href}
                    onClick={(ev) => {
                      ev.preventDefault();
                      pick(e.href);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`relative flex items-center gap-3 px-4 py-2 text-[13px] transition-colors duration-base ${
                      isActive
                        ? "bg-surface-2 text-text"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-primary"
                      />
                    )}
                    <e.Icon size={16} className={isActive ? "text-text" : "text-text-muted"} />
                    <span className="flex-1 truncate">{e.label}</span>
                    <span className="font-mono text-[10px] text-text-subtle truncate">
                      {e.hint}
                    </span>
                    <span className="font-mono text-[10px] text-text-subtle hidden sm:inline">
                      {e.href}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
        <div className="relative flex items-center justify-between px-4 py-2 border-t border-border text-[10px] text-text-subtle font-mono">
          <span>
            <span className="px-1 py-0.5 rounded border border-border bg-surface-2 text-text-muted">↑↓</span>
            <span className="ml-1">选择</span>
            <span className="mx-2">·</span>
            <span className="px-1 py-0.5 rounded border border-border bg-surface-2 text-text-muted">↵</span>
            <span className="ml-1">打开</span>
          </span>
          <span>
            <span className="px-1 py-0.5 rounded border border-border bg-surface-2 text-text-muted">⌘K</span>
            <span className="ml-1">唤起 / 关闭</span>
          </span>
        </div>
      </div>
    </div>
  );
}

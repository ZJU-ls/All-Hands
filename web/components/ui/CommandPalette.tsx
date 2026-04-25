"use client";

/**
 * CommandPalette · ⌘K route jump · Brand Blue Dual Theme (ADR 0016)
 *
 * - ⌘K / Ctrl+K anywhere in the app opens / closes (wired in AppShell).
 * - Fuzzy substring match over label + href + hint + keywords.
 * - Arrow keys navigate, Enter opens, Esc closes.
 * - Active row uses `bg-primary-muted text-primary` + 2px left primary bar
 *   (per ADR 0016 §D2 "option row" activation language).
 * - Visual: rounded-2xl card · shadow-soft-lg · DotGrid backdrop · ah-fade-up
 *   entrance.
 *
 * Routes are declared here; when the product grows, migrate to a registry
 * with each feature declaring its own entries.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import { DotGridBackdrop } from "./DotGridBackdrop";

type EntryKey =
  | "cockpit"
  | "chat"
  | "conversations"
  | "tasks"
  | "employees"
  | "employeeDesign"
  | "skills"
  | "mcp"
  | "gateway"
  | "market"
  | "triggers"
  | "channels"
  | "confirmations"
  | "traces"
  | "observatory"
  | "stockAssistant"
  | "review"
  | "settings"
  | "about";

type Entry = {
  key: EntryKey;
  label: string;
  href: string;
  hint: string;
  icon: IconName;
  keywords?: string;
};

type EntryDef = Omit<Entry, "label">;

// Icons mirror the AppShell sidebar mapping (ADR 0016 §D1 · all business
// icons route through <Icon name="...">).
const ENTRY_DEFS: EntryDef[] = [
  { key: "cockpit", href: "/", hint: "workspace snapshot", icon: "layout-grid", keywords: "home dashboard cockpit" },
  { key: "chat", href: "/chat", hint: "chat with lead", icon: "message-square", keywords: "chat lead" },
  { key: "conversations", href: "/conversations", hint: "past conversations", icon: "clock", keywords: "history conversations" },
  { key: "tasks", href: "/tasks", hint: "async tasks", icon: "check-circle-2", keywords: "tasks jobs async" },
  { key: "employees", href: "/employees", hint: "digital employees", icon: "users", keywords: "employees agents team" },
  { key: "employeeDesign", href: "/employees/design", hint: "design new employee", icon: "user-plus", keywords: "employee design new" },
  { key: "skills", href: "/skills", hint: "skill packs", icon: "wand-2", keywords: "skills abilities prompts" },
  { key: "mcp", href: "/mcp-servers", hint: "external mcp", icon: "plug", keywords: "mcp plugins servers" },
  { key: "gateway", href: "/gateway", hint: "provider + model gateway", icon: "server", keywords: "gateway llm provider model openai anthropic" },
  { key: "market", href: "/market", hint: "browse skill market", icon: "store", keywords: "market skills browse install" },
  { key: "triggers", href: "/triggers", hint: "scheduled + webhook", icon: "zap", keywords: "triggers cron webhook schedule" },
  { key: "channels", href: "/channels", hint: "slack email webhook", icon: "bell", keywords: "channels notifications slack email webhook" },
  { key: "confirmations", href: "/confirmations", hint: "pending approvals", icon: "shield-check", keywords: "confirmations approvals gate" },
  { key: "traces", href: "/traces", hint: "langfuse traces", icon: "activity", keywords: "traces observability langfuse" },
  { key: "observatory", href: "/observatory", hint: "platform observability", icon: "brain", keywords: "observatory metrics dashboard" },
  { key: "stockAssistant", href: "/stock-assistant", hint: "market anomaly demo", icon: "trending-up", keywords: "stock market demo" },
  { key: "review", href: "/review", hint: "agent review", icon: "check", keywords: "review approvals" },
  { key: "settings", href: "/settings", hint: "system settings", icon: "settings", keywords: "settings config" },
  { key: "about", href: "/about", hint: "about allhands", icon: "info", keywords: "about version" },
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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
      {children}
    </span>
  );
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
  const t = useTranslations("ui.commandPalette");
  const ENTRIES = useMemo<Entry[]>(
    () => ENTRY_DEFS.map((e) => ({ ...e, label: t(`entries.${e.key}`) })),
    [t],
  );
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
  }, [query, ENTRIES]);

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
      aria-label={t("ariaLabel")}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[15vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg"
        style={{ animation: "ah-fade-up 220ms var(--ease-out-expo) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <DotGridBackdrop opacity={0.22} />

        {/* Search input */}
        <div className="relative flex h-12 items-center gap-2.5 border-b border-border px-4">
          <Icon name="search" size={16} className="shrink-0 text-primary" />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onListKey}
            placeholder={t("placeholder")}
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-subtle outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        {/* Results */}
        <div className="relative px-2 py-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-text-muted">
              <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-text-subtle">
                <Icon name="search" size={18} />
              </div>
              {t("noMatch")}
            </div>
          ) : (
            <>
              {!query && (
                <div className="px-3 pb-1.5 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-subtle">
                  {t("suggestions", { count: filtered.length })}
                </div>
              )}
              <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
                {filtered.map((e, i) => {
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
                        className={
                          isActive
                            ? "relative flex items-center gap-3 rounded-lg bg-primary-muted px-3 py-2 text-sm text-primary transition duration-fast"
                            : "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast"
                        }
                      >
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary"
                          />
                        )}
                        <Icon
                          name={e.icon}
                          size={14}
                          className={isActive ? "" : "text-text-subtle"}
                        />
                        <span className="flex-1 truncate font-medium">{e.label}</span>
                        <span className="hidden truncate font-mono text-[11px] text-text-subtle sm:inline">
                          {e.hint}
                        </span>
                        <span className="font-mono text-[10px] text-text-subtle opacity-60">
                          {e.href}
                        </span>
                        {isActive && (
                          <Icon name="arrow-right" size={12} className="ml-1" />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between gap-4 border-t border-border bg-surface-2/40 px-4 py-2 font-mono text-[10px] text-text-subtle">
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd>
            <span>{t("footer.navigate")}</span>
            <span className="mx-1.5">·</span>
            <Kbd>↵</Kbd>
            <span>{t("footer.open")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>⌘K</Kbd>
            <span>{t("footer.toggle")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

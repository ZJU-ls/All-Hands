"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { cn } from "@/lib/cn";
import type { McpServerDto } from "@/lib/api";

/**
 * McpMultiPicker · upgraded 2026-04-26
 *
 * Why the rewrite: same disease as SkillMultiPicker — a flat chip cloud with
 * no search and no health-based ordering. Once you register 8+ MCP servers
 * with mixed health, the picker becomes a "find the green one" treasure
 * hunt. Failed servers visually fight the user when they're trying to
 * mount a healthy one.
 *
 * New shape:
 *
 *   ┌─ search box ────────────────────────────────────┐
 *   │ 🔍 搜索…             3 / 8       [/]             │
 *   ├─────────────────────────────────────────────────┤
 *   │ ▼ 已选 · 2                                       │
 *   │   [✓ github stdio · OK] [✓ filesystem ...]      │
 *   │ ▼ 在线 · 4                                       │
 *   │   [slack sse · OK] [...]                         │
 *   │ ▼ 不健康 · 2  (默认折叠 · 失败的别影响选健康的)  │
 *   │   [postgres http · UNREACHABLE] [...]           │
 *   └─────────────────────────────────────────────────┘
 *
 * Health classification (matches backend MCPHealth enum):
 *   - "ok"           → 在线 (auto-open)
 *   - "unknown"      → 在线 (no probe yet — neutral)
 *   - "unreachable"  → 不健康 (collapsed by default)
 *   - "auth_failed"  → 不健康
 *   - "*"            → 不健康 (defensive: any new failure mode)
 *
 * Selected items always render in their own group at the top regardless
 * of health/filter — preserving "what's mounted right now" visibility.
 */

const HEALTHY_STATES = new Set(["ok", "unknown"]);

export function McpMultiPicker({
  servers,
  selected,
  onToggle,
}: {
  servers: McpServerDto[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("employees.mcpPicker");
  const [query, setQuery] = useState("");

  const lcQuery = query.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!lcQuery) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(lcQuery) ||
        s.transport.toLowerCase().includes(lcQuery) ||
        s.health.toLowerCase().includes(lcQuery),
    );
  }, [servers, lcQuery]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const groups = useMemo(() => {
    const selectedServers = servers.filter((s) => selectedSet.has(s.id));
    const healthy: McpServerDto[] = [];
    const unhealthy: McpServerDto[] = [];
    for (const s of matched) {
      if (HEALTHY_STATES.has(s.health.toLowerCase())) healthy.push(s);
      else unhealthy.push(s);
    }
    return { selected: selectedServers, healthy, unhealthy };
  }, [servers, matched, selectedSet]);

  if (servers.length === 0) {
    return <p className="text-[12px] text-text-muted">{t("empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t("searchPlaceholder")}
        count={matched.length}
        total={servers.length}
        compact
        autoFocusOnSlash
        testId="mcp-picker-search"
      />
      <Group
        title={t("groupSelected")}
        count={groups.selected.length}
        items={groups.selected}
        selected={selectedSet}
        onToggle={onToggle}
        defaultOpen
        tone="primary"
        emptyHint={t("selectedEmpty")}
      />
      <Group
        title={t("groupHealthy")}
        count={groups.healthy.length}
        items={groups.healthy}
        selected={selectedSet}
        onToggle={onToggle}
        defaultOpen
      />
      <Group
        title={t("groupUnhealthy")}
        count={groups.unhealthy.length}
        items={groups.unhealthy}
        selected={selectedSet}
        onToggle={onToggle}
        tone="danger"
      />
      {lcQuery &&
        matched.length === 0 &&
        groups.selected.length === 0 && (
          <p
            data-testid="mcp-picker-no-match"
            className="text-[12px] text-text-subtle italic px-1"
          >
            {t("noMatch", { query })}
          </p>
        )}
    </div>
  );
}

function Group({
  title,
  count,
  items,
  selected,
  onToggle,
  emptyHint,
  defaultOpen = false,
  tone = "neutral",
}: {
  title: string;
  count: number;
  items: McpServerDto[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyHint?: string;
  defaultOpen?: boolean;
  tone?: "neutral" | "primary" | "danger";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const effectiveOpen = open || (count > 0 && count <= 6);
  if (count === 0 && !emptyHint) return null;
  return (
    <section className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={effectiveOpen}
        className="w-full flex items-center gap-2 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
      >
        <Icon
          name="chevron-down"
          size={11}
          className={cn(
            "text-text-subtle transition-transform duration-fast",
            effectiveOpen ? "" : "-rotate-90",
          )}
        />
        <span
          className={cn(
            "text-[10.5px] uppercase tracking-[0.08em] font-mono",
            tone === "primary"
              ? "text-primary"
              : tone === "danger"
                ? "text-danger"
                : "text-text-subtle",
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "font-mono text-[10.5px] tabular-nums",
            tone === "primary" && count > 0
              ? "text-primary"
              : tone === "danger" && count > 0
                ? "text-danger"
                : "text-text-subtle",
          )}
        >
          · {count}
        </span>
        <span aria-hidden className="flex-1 h-px bg-border" />
      </button>
      {effectiveOpen && (
        <ul className="flex flex-wrap gap-1.5 pl-4">
          {count === 0 && emptyHint && (
            <li className="text-[11px] text-text-subtle italic px-1.5 py-1">
              {emptyHint}
            </li>
          )}
          {items.map((s) => {
            const on = selected.has(s.id);
            return (
              <li key={s.id}>
                <McpChip server={s} on={on} onToggle={() => onToggle(s.id)} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function McpChip({
  server,
  on,
  onToggle,
}: {
  server: McpServerDto;
  on: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("employees.mcpPicker");
  const isFailed = !HEALTHY_STATES.has(server.health.toLowerCase());
  const healthDot = isFailed ? "bg-danger" : "bg-success";
  const title = isFailed ? t("chipFailedTitle", { health: server.health }) : undefined;
  return (
    <button
      type="button"
      data-testid={`mcp-${server.id}`}
      aria-pressed={on}
      onClick={onToggle}
      title={title}
      className={cn(
        "inline-flex max-w-[280px] items-center gap-1.5 rounded-md px-2.5 py-1 text-left transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        on
          ? "bg-primary-muted text-primary border border-primary/30"
          : isFailed
            ? "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text border border-danger/20"
            : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text border border-transparent",
      )}
    >
      <Icon name={on ? "check" : "plug"} size={12} className="shrink-0" />
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full shrink-0", healthDot)} />
      <span className="truncate text-[12px] font-medium">{server.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-text-subtle uppercase">
        {server.transport}
      </span>
    </button>
  );
}

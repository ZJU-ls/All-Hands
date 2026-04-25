"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import type { McpServerDto } from "@/lib/api";

/**
 * V2 (ADR 0016): chip cloud. Selected chip = bg-primary-muted text-primary with
 * a check glyph; unselected = bg-surface-2 text-text-muted + hover:bg-surface-3.
 * Each chip also surfaces transport + health as mono microtext.
 */
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
  if (servers.length === 0) {
    return (
      <p className="text-[12px] text-text-muted">
        {t("empty")}
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {servers.map((s) => {
        const on = selected.includes(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              data-testid={`mcp-${s.id}`}
              aria-pressed={on}
              onClick={() => onToggle(s.id)}
              className={
                "group inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors duration-fast " +
                (on
                  ? "bg-primary-muted text-primary"
                  : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-text")
              }
            >
              <Icon
                name={on ? "check" : "plug"}
                size={13}
                className="shrink-0"
              />
              <span className="text-[12px] font-medium">{s.name}</span>
              <span className="font-mono text-[10px] text-text-subtle">
                {s.transport} · {s.health}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

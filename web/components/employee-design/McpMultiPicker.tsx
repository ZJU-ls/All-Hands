"use client";

import { PluginIcon, CheckIcon } from "@/components/icons";
import type { McpServerDto } from "@/lib/api";

export function McpMultiPicker({
  servers,
  selected,
  onToggle,
}: {
  servers: McpServerDto[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (servers.length === 0) {
    return (
      <p className="text-[12px] text-text-muted">
        还没有注册 MCP 服务器。先去「MCP 服务器」页注册,再回来挂载。
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {servers.map((s) => {
        const on = selected.includes(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              data-testid={`mcp-${s.id}`}
              aria-pressed={on}
              onClick={() => onToggle(s.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border transition-colors duration-base text-left ${
                on
                  ? "border-primary/60 bg-primary/5"
                  : "border-border hover:bg-surface-2"
              }`}
            >
              <PluginIcon size={14} className="text-text-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-text">{s.name}</div>
                <div className="text-[11px] text-text-muted">
                  {s.transport} · {s.health}
                </div>
              </div>
              {on && <CheckIcon size={14} className="text-primary shrink-0" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import type {
  ComponentStatusDto,
  ComponentStatusKind,
  HealthSnapshotDto,
} from "@/lib/cockpit-api";

function statusLabel(kind: ComponentStatusKind): string {
  if (kind === "ok") return "●";
  if (kind === "degraded") return "◐";
  return "○";
}

function statusColorClass(kind: ComponentStatusKind): string {
  if (kind === "ok") return "text-success";
  if (kind === "degraded") return "text-warning";
  return "text-danger";
}

const LABELS: Record<keyof HealthSnapshotDto, string> = {
  gateway: "Gateway",
  mcp_servers: "MCP",
  langfuse: "Langfuse",
  db: "DB",
  triggers: "Triggers",
};

function Row({ label, comp }: { label: string; comp: ComponentStatusDto }) {
  return (
    <li className="flex items-center justify-between h-7 px-3 text-[12px]">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`font-mono text-[13px] leading-none ${statusColorClass(comp.status)}`}
          aria-label={comp.status}
        >
          {statusLabel(comp.status)}
        </span>
        <span className="text-text">{label}</span>
      </div>
      <span className="font-mono text-[10px] text-text-subtle truncate max-w-[60%] text-right">
        {comp.detail ?? comp.status}
      </span>
    </li>
  );
}

export function HealthPanel({ health }: { health: HealthSnapshotDto }) {
  const keys: (keyof HealthSnapshotDto)[] = [
    "gateway",
    "mcp_servers",
    "langfuse",
    "db",
    "triggers",
  ];
  return (
    <section className="flex flex-col min-h-0">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          健康
        </span>
      </header>
      <ul className="divide-y divide-border">
        {keys.map((k) => (
          <Row key={k} label={LABELS[k]} comp={health[k]} />
        ))}
      </ul>
    </section>
  );
}

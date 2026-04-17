"use client";

import { useEffect, useState } from "react";

type State = { status: "loading" } | { status: "ok"; version: string } | { status: "error" };

export function HealthBadge() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { status: string; version: string }) =>
        setState({ status: "ok", version: data.version }),
      )
      .catch(() => setState({ status: "error" }));
    return () => controller.abort();
  }, []);

  const cls =
    state.status === "ok"
      ? "bg-success/10 text-success border-success/30"
      : state.status === "error"
        ? "bg-danger/10 text-danger border-danger/30"
        : "bg-surface-2 text-text-muted border-border";

  const label =
    state.status === "ok"
      ? `backend ok · ${state.version}`
      : state.status === "error"
        ? "backend unreachable"
        : "pinging backend…";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 font-mono text-xs ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

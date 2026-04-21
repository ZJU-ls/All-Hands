"use client";

import { use } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { RunTracePanel } from "@/components/runs/RunTracePanel";

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  const { run_id: runId } = use(params);
  const shortId = runId.length > 10 ? `${runId.slice(0, 10)}…` : runId;

  return (
    <AppShell title={`trace · ${shortId}`}>
      <div
        data-testid="run-detail-page"
        className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-6 py-6"
      >
        <RunTracePanel runId={runId} />
      </div>
    </AppShell>
  );
}

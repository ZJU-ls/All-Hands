"use client";

import { useCallback, useEffect, useState } from "react";
import { listArtifacts, type ArtifactDto } from "@/lib/artifacts-api";
import { ArtifactList } from "./ArtifactList";
import { ArtifactDetail } from "./ArtifactDetail";

export function ArtifactPanel({ onClose }: { onClose: () => void }) {
  const [artifacts, setArtifacts] = useState<ArtifactDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const items = await listArtifacts({ limit: 200 });
      setArtifacts(items);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      void refresh();
    }, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <aside
      aria-label="制品区"
      className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-surface"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold tracking-tight text-text">制品区</span>
          <span className="font-mono text-[10px] text-text-subtle">
            {artifacts.length}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="关闭制品区"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border font-mono text-[11px] text-text-muted transition-colors duration-base hover:text-text hover:border-border-strong"
          title="关闭 · Cmd/Ctrl+J"
        >
          ×
        </button>
      </div>
      {error && (
        <div className="border-b border-border bg-surface-2 px-3 py-2 text-[11px] text-danger">
          {error}
        </div>
      )}
      {selectedId ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <button
            onClick={() => setSelectedId(null)}
            className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-3 text-left font-mono text-[11px] text-text-muted transition-colors duration-base hover:text-text"
          >
            ← 返回列表
          </button>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ArtifactDetail artifactId={selectedId} />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ArtifactList
            artifacts={artifacts}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
          />
        </div>
      )}
    </aside>
  );
}

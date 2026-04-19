"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  artifactStreamUrl,
  getArtifact,
  listArtifacts,
  type ArtifactChangedFrame,
  type ArtifactDto,
} from "@/lib/artifacts-api";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { ArtifactList } from "./ArtifactList";
import { ArtifactDetail } from "./ArtifactDetail";

type LoadState = "loading" | "ok" | "error";
type StreamConnection = "connecting" | "open" | "error";

export function ArtifactPanel({ onClose }: { onClose: () => void }) {
  const [artifacts, setArtifacts] = useState<ArtifactDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [streamConn, setStreamConn] = useState<StreamConnection>("connecting");

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const items = await listArtifacts({ limit: 200 });
      setArtifacts(items);
      setError(null);
      setState("ok");
    } catch (e) {
      setError(String(e));
      setState((prev) => (prev === "ok" ? "ok" : "error"));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live feed: /api/artifacts/stream pushes `artifact_changed` frames for
  // create / update / delete / pin. We patch local state in-place — the REST
  // snapshot we pulled on mount stays the source of truth for everything else.
  useEffect(() => {
    let cancelled = false;
    const source = new EventSource(artifactStreamUrl());

    const markOpen = () => {
      if (!cancelled) setStreamConn("open");
    };
    source.addEventListener("open", markOpen);
    source.addEventListener("RUN_STARTED", markOpen);
    source.addEventListener("error", () => {
      if (!cancelled) setStreamConn("error");
    });

    const handleArtifactChanged = async (frame: ArtifactChangedFrame) => {
      const payload = frame.payload;
      if (!payload?.artifact_id || !payload.op) return;
      const artifactId = payload.artifact_id;

      if (payload.op === "deleted") {
        setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
        if (selectedIdRef.current === artifactId) setSelectedId(null);
        return;
      }

      try {
        const fresh = await getArtifact(artifactId);
        if (cancelled) return;
        setArtifacts((prev) => {
          const idx = prev.findIndex((a) => a.id === artifactId);
          if (idx === -1) return [fresh, ...prev];
          const next = prev.slice();
          next[idx] = fresh;
          return next;
        });
      } catch {
        // Fall back to a full refetch if the targeted GET fails — keeps the
        // panel in sync even if the artifact was swapped for a new id.
        if (!cancelled) void refresh();
      }
    };

    // AG-UI v1: `allhands.artifacts_ready` / `allhands.artifact_changed` /
    // `allhands.heartbeat` all ride inside CUSTOM envelopes. Inspect
    // `data.name` to dispatch; the legacy payload is in `data.value`.
    source.addEventListener("CUSTOM", (evt) => {
      if (cancelled) return;
      let data: { name?: string; value?: unknown };
      try {
        data = JSON.parse((evt as MessageEvent).data) as {
          name?: string;
          value?: unknown;
        };
      } catch {
        return;
      }
      const name = data.name ?? "";
      if (name === "allhands.artifacts_ready" || name === "allhands.heartbeat") {
        markOpen();
        return;
      }
      if (name === "allhands.artifact_changed") {
        void handleArtifactChanged((data.value ?? {}) as ArtifactChangedFrame);
      }
    });

    return () => {
      cancelled = true;
      source.close();
    };
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
          {streamConn === "error" && (
            <span
              className="font-mono text-[10px] text-warning"
              title="实时流中断 · 浏览器会自动重连"
            >
              · offline
            </span>
          )}
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
        <div className="flex-1 overflow-y-auto p-3">
          {state === "loading" ? (
            <LoadingState
              title="加载制品区"
              description="正在拉取工作区的制品列表"
            />
          ) : state === "error" && artifacts.length === 0 ? (
            <ErrorState
              title="制品列表加载失败"
              detail={error ?? undefined}
              action={{ label: "重试", onClick: () => void refresh() }}
            />
          ) : artifacts.length === 0 ? (
            <EmptyState
              title="还没有制品"
              description="让员工产出一份文档、代码或图,制品会实时出现在这里。"
            />
          ) : (
            <ArtifactList
              artifacts={artifacts}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
            />
          )}
        </div>
      )}
    </aside>
  );
}

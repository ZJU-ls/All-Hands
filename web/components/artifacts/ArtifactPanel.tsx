"use client";

/**
 * ArtifactPanel · right-side drawer listing every workspace artifact.
 * V2-level (ADR 0016). Keeps all data-fetching + live-feed logic identical
 * to the pre-rework version — rework is presentational only.
 */

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import {
  artifactStreamUrl,
  getArtifact,
  listArtifacts,
  type ArtifactChangedFrame,
  type ArtifactDto,
} from "@/lib/artifacts-api";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { useArtifactFocus } from "@/lib/artifact-focus-store";
import { ArtifactList } from "./ArtifactList";
import { ArtifactDetail } from "./ArtifactDetail";

type LoadState = "loading" | "ok" | "error";
type StreamConnection = "connecting" | "open" | "error";

export function ArtifactPanel({
  onClose,
  conversationId,
}: {
  onClose: () => void;
  // 2026-04-25 v2 · scope chat-side panel to current conversation. Undefined =
  // workspace-global behaviour (preserved for legacy / tests). The /artifacts
  // page builds its own list view directly off `listArtifacts({...filter})`.
  conversationId?: string;
}) {
  const t = useTranslations("artifacts.panel");
  const [artifacts, setArtifacts] = useState<ArtifactDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [streamConn, setStreamConn] = useState<StreamConnection>("connecting");

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // External focus: a chat-side `Artifact.Card` click drops the target id
  // into the focus store. We sync both ways: when the store fires, jump to
  // detail view; when the user backs out manually, clear the store so the
  // next dispatch (even with the same id) still re-triggers (bumpTick).
  const focusedId = useArtifactFocus((s) => s.artifactId);
  const focusBump = useArtifactFocus((s) => s.bumpTick);
  const clearFocus = useArtifactFocus((s) => s.clear);
  useEffect(() => {
    if (focusedId) setSelectedId(focusedId);
  }, [focusedId, focusBump]);

  // Resizable panel width. Drag the left edge to widen — drawio / html /
  // pdf detail views fit the viewport better at 480-800px than the
  // default 360px. Persist across mounts via localStorage.
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 1200;
  const DEFAULT_WIDTH = 480;
  const [panelWidth, setPanelWidth] = useState<number>(DEFAULT_WIDTH);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("allhands.artifact_panel_width");
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) setPanelWidth(n);
    }
  }, []);
  const persistWidth = useCallback((w: number) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("allhands.artifact_panel_width", String(w));
  }, []);
  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelWidth;
      const onMove = (ev: PointerEvent) => {
        // dragging left grows the panel (it's docked right)
        const delta = startX - ev.clientX;
        const next = Math.max(
          MIN_WIDTH,
          Math.min(MAX_WIDTH, startW + delta),
        );
        setPanelWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setPanelWidth((w) => {
          persistWidth(w);
          return w;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelWidth, persistWidth],
  );

  const refresh = useCallback(async () => {
    try {
      const items = await listArtifacts({ limit: 200, conversationId });
      setArtifacts(items);
      setError(null);
      setState("ok");
    } catch (e) {
      setError(String(e));
      setState((prev) => (prev === "ok" ? "ok" : "error"));
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      // Scope filter (v2): drop frames for artifacts produced by other
      // conversations. Cross-conversation artifacts still surface globally
      // via /artifacts; the chat-side panel stays local.
      if (conversationId && payload.conversation_id !== conversationId) return;
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
        if (!cancelled) void refresh();
      }
    };

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
  }, [refresh, conversationId]);

  return (
    <aside
      aria-label={t("ariaLabel")}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface shadow-soft-lg"
      style={{ width: `${panelWidth}px` }}
    >
      {/* Resize handle · drag left edge to widen */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resizeAria")}
        title={t("resizeTitle")}
        onPointerDown={startResize}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors duration-fast hover:bg-primary/30"
      />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-2/60 px-3">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-lg bg-primary-muted text-primary"
        >
          <Icon name="folder" size={14} strokeWidth={2} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-text">
          {t("title")}
        </span>
        <span className="inline-flex h-5 items-center rounded-md bg-surface-2 px-1.5 font-mono text-[10px] text-text-muted">
          {artifacts.length}
        </span>
        {streamConn === "error" && (
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] text-warning"
            title={t("offlineTitle")}
          >
            <Icon name="alert-circle" size={10} />
            {t("offline")}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeAria")}
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors duration-fast ease-out hover:border-border-strong hover:text-text"
          title={t("closeTitle")}
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      {selectedId ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              clearFocus();
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-3 text-left font-mono text-[11px] text-text-muted transition-colors duration-fast ease-out hover:bg-surface-2 hover:text-text"
          >
            <Icon name="arrow-left" size={12} />
            {t("back")}
          </button>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ArtifactDetail artifactId={selectedId} />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          {state === "loading" ? (
            <LoadingState
              title={t("loading.title")}
              description={t("loading.description")}
            />
          ) : state === "error" && artifacts.length === 0 ? (
            <ErrorState
              title={t("error.title")}
              detail={error ?? undefined}
              action={{ label: t("error.retry"), onClick: () => void refresh() }}
            />
          ) : artifacts.length === 0 ? (
            <EmptyState
              title={t("empty.title")}
              description={t("empty.description")}
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

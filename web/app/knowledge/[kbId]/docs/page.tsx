"use client";

/**
 * /knowledge/[kbId]/docs · Documents tab.
 *
 * Full-bleed doc grid + filter bar + bulk-select. The old single-page
 * jammed this view next to a sidebar / search / ask; here it gets the whole
 * canvas. URL-encodes filters so reload / share preserves state.
 *
 * Query params:
 *   ?state=ready|indexing|failed
 *   ?tag=<name>
 *   ?upload=1   → triggers AddDocumentMenu/file picker on mount (from Overview)
 *   ?ingestUrl=1 → opens Ingest URL modal on mount
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { computePopoverSide } from "@/lib/popover-placement";
import { useLayoutEffect } from "react";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/state";
import { useKBContext } from "@/components/knowledge/KBContext";
import {
  type DocumentDto,
  deleteDocument,
  ingestUrl,
  listDocuments,
  patchDocumentTags,
  reindexDocument,
  uploadDocument,
} from "@/lib/kb-api";
import { ModalShell } from "@/components/knowledge/ModalShell";
import { Field } from "@/components/knowledge/Field";

type StateFilter = "" | "ready" | "indexing" | "failed";

export default function DocumentsTabPage() {
  // Next.js 15 requires useSearchParams consumers to sit inside Suspense (E03).
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <DocumentsTabInner />
    </Suspense>
  );
}

function DocumentsTabInner() {
  const { kb, refresh: refreshKb } = useKBContext();
  const t = useTranslations("knowledge");
  const td = useTranslations("knowledge.docs");
  const router = useRouter();
  const search = useSearchParams();
  const stateFilter = (search.get("state") ?? "") as StateFilter;
  const tagFilter = search.get("tag") ?? null;
  const wantUpload = search.get("upload") === "1";
  const wantUrlIngest = search.get("ingestUrl") === "1";

  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [showUrlIngest, setShowUrlIngest] = useState(wantUrlIngest);
  const [showBulkTag, setShowBulkTag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  type UploadEntry = {
    id: string;
    name: string;
    state: "queued" | "uploading" | "done" | "failed";
    error?: string;
  };

  async function refreshDocs() {
    try {
      setDocs(await listDocuments(kb.id, { limit: 200 }));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void refreshDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kb.id]);

  useEffect(() => {
    // honour ?upload=1 by triggering file picker once on mount.
    if (wantUpload && fileInputRef.current) {
      fileInputRef.current.click();
      // strip the query so it doesn't re-fire on every render.
      const next = new URL(window.location.href);
      next.searchParams.delete("upload");
      router.replace(next.pathname + (next.search ? next.search : ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantUpload]);

  // Sort + view-mode driven by URL so deep-linking holds the layout.
  const sortBy = (search.get("sort") ?? "recent") as
    | "recent"
    | "oldest"
    | "name"
    | "size"
    | "chunks";
  const view = (search.get("view") ?? "grid") as "grid" | "list";

  const filteredDocs = useMemo(() => {
    if (!docs) return [];
    const filtered = docs.filter((d) => {
      if (stateFilter && d.state !== stateFilter) return false;
      if (tagFilter && !d.tags.includes(tagFilter)) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return a.created_at.localeCompare(b.created_at);
        case "name":
          return a.title.localeCompare(b.title);
        case "size":
          return b.size_bytes - a.size_bytes;
        case "chunks":
          return b.chunk_count - a.chunk_count;
        case "recent":
        default:
          return b.updated_at.localeCompare(a.updated_at);
      }
    });
    return sorted;
  }, [docs, stateFilter, tagFilter, sortBy]);

  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs ?? []) for (const t of d.tags) set.add(t);
    return Array.from(set).sort();
  }, [docs]);

  function setQueryParam(key: string, value: string | null) {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(`/knowledge/${kb.id}/docs${qs ? `?${qs}` : ""}`);
  }

  async function handleUploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    const entries: UploadEntry[] = list.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      state: "queued",
    }));
    setUploads((prev) => [...entries, ...prev].slice(0, 20));
    setUploading(true);
    try {
      for (const e of entries) {
        const file = list[entries.indexOf(e)];
        if (!file) continue;
        setUploads((prev) =>
          prev.map((p) => (p.id === e.id ? { ...p, state: "uploading" } : p)),
        );
        try {
          await uploadDocument(kb.id, file, { title: file.name });
          setUploads((prev) =>
            prev.map((p) => (p.id === e.id ? { ...p, state: "done" } : p)),
          );
        } catch (err) {
          setUploads((prev) =>
            prev.map((p) =>
              p.id === e.id ? { ...p, state: "failed", error: String(err) } : p,
            ),
          );
        }
      }
      await refreshDocs();
      await refreshKb();
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploads((prev) => prev.filter((p) => p.state !== "done"));
      }, 4000);
    }
  }

  // Page-level drag-drop receiver
  const [dragOver, setDragOver] = useState(false);
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (
      e.currentTarget === e.target ||
      !e.currentTarget.contains(e.relatedTarget as Node)
    ) {
      setDragOver(false);
    }
  }
  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!e.dataTransfer.files.length) return;
    await handleUploadFiles(e.dataTransfer.files);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(t("delete.bulkConfirm", { count: selected.size }))) return;
    try {
      for (const id of selected) await deleteDocument(kb.id, id);
      setSelected(new Set());
      await refreshDocs();
      await refreshKb();
    } catch (e) {
      setError(String(e));
    }
  }

  async function applyBulkTags(addList: string[], removeList: string[]) {
    setShowBulkTag(false);
    if (addList.length === 0 && removeList.length === 0) return;
    const failures: string[] = [];
    for (const id of selected) {
      try {
        await patchDocumentTags(kb.id, id, {
          add: addList.length ? addList : undefined,
          remove: removeList.length ? removeList : undefined,
        });
      } catch (e) {
        failures.push(`${id.slice(0, 8)}: ${e}`);
      }
    }
    if (failures.length > 0) {
      setError(`Bulk tag · ${failures.length} failed:\n${failures.join("\n")}`);
    }
    setSelected(new Set());
    await refreshDocs();
  }

  async function handleReindex(d: DocumentDto) {
    try {
      await reindexDocument(kb.id, d.id);
      await refreshDocs();
      await refreshKb();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      className={`relative flex flex-1 flex-col overflow-hidden ${
        dragOver ? "outline-dashed outline-2 outline-primary outline-offset-[-12px]" : ""
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
    >
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-5 py-3">
        <Select
          value={stateFilter}
          onChange={(v) => setQueryParam("state", v)}
          options={[
            { value: "", label: t("toolbar.stateAll") },
            { value: "ready", label: t("toolbar.stateReady") },
            { value: "indexing", label: t("toolbar.stateIndexing") },
            { value: "failed", label: t("toolbar.stateFailed") },
          ]}
          className="min-w-[120px]"
          triggerClassName="h-8 rounded-lg text-[12px]"
          ariaLabel={t("toolbar.stateFilterAria")}
        />
        {knownTags.length > 0 && (
          <Select
            value={tagFilter ?? ""}
            onChange={(v) => setQueryParam("tag", v || null)}
            options={[
              { value: "", label: td("allTags") },
              ...knownTags.map((tg) => ({ value: tg, label: `#${tg}` })),
            ]}
            className="min-w-[120px]"
            triggerClassName="h-8 rounded-lg text-[12px]"
            ariaLabel={td("allTags")}
          />
        )}
        {tagFilter && (
          <button
            type="button"
            onClick={() => setQueryParam("tag", null)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/40 bg-primary-muted px-2 text-[11px] text-primary"
            title={td("removeTagFilter")}
          >
            #{tagFilter} ✕
          </button>
        )}

        {/* Sort dropdown + view toggle — Linear/Notion pattern. URL-encoded. */}
        <Select
          value={sortBy}
          onChange={(v) => setQueryParam("sort", v === "recent" ? null : v)}
          options={[
            { value: "recent", label: td("sortRecent") },
            { value: "oldest", label: td("sortOldest") },
            { value: "name", label: td("sortName") },
            { value: "size", label: td("sortSize") },
            { value: "chunks", label: td("sortChunks") },
          ]}
          className="min-w-[120px]"
          triggerClassName="h-8 rounded-lg text-[12px]"
          ariaLabel={td("sortAria")}
        />
        <div className="inline-flex h-8 items-center rounded-lg border border-border bg-surface p-0.5">
          {(["grid", "list"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setQueryParam("view", m === "grid" ? null : m)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
                view === m
                  ? "bg-primary-muted text-primary"
                  : "text-text-subtle hover:text-text"
              }`}
              title={m === "grid" ? td("viewGrid") : td("viewList")}
              aria-label={m === "grid" ? td("viewGrid") : td("viewList")}
            >
              <Icon name={m === "grid" ? "layout-grid" : "list"} size={13} />
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-[11px] text-text-muted">
                {td("selectedCount", { count: selected.size })}
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2 text-[11px] text-text-muted hover:text-text"
              >
                {td("cancel")}
              </button>
              <button
                type="button"
                onClick={() => setShowBulkTag(true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
              >
                <Icon name="tag" size={11} />
                {td("bulkTags")}
              </button>
              <button
                type="button"
                onClick={() => void bulkDelete()}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-danger/40 bg-danger-soft px-2 text-[11px] text-danger hover:bg-danger/10"
              >
                <Icon name="trash-2" size={11} />
                {td("bulkDelete")}
              </button>
            </>
          )}
          <AddDocumentMenu
            disabled={uploading}
            uploading={uploading}
            inputRef={fileInputRef}
            onPickFiles={(files) => void handleUploadFiles(files)}
            onPickUrl={() => setShowUrlIngest(true)}
          />
        </div>
      </div>

      {/* Upload progress strip */}
      {uploads.length > 0 && (
        <div className="border-b border-border bg-surface-2 px-5 py-2 text-[11px] text-text-muted">
          {td("uploadingProgress", {
            done: uploads.filter((u) => u.state === "done").length,
            total: uploads.length,
          })}
        </div>
      )}

      {/* Drag overlay */}
      {dragOver && (
        <div
          className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
          aria-hidden="true"
        >
          <div className="rounded-2xl border border-primary bg-surface px-8 py-6 text-center shadow-soft-lg">
            <Icon
              name="upload"
              size={28}
              className="mx-auto mb-2 text-primary"
            />
            <div className="text-[14px] font-semibold text-text">
              {t("dragOverlay.drop", { kb: kb.name })}
            </div>
            <div className="font-mono text-[11px] text-text-subtle">
              {t("dragOverlay.supportedFormats")}
            </div>
          </div>
        </div>
      )}

      {/* Doc grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {!docs ? (
          <p className="text-[12px] text-text-muted">{td("loading")}</p>
        ) : docs.length === 0 ? (
          <EmptyState
            title={td("emptyTitle")}
            description={td("emptyDesc")}
            action={{
              label: td("emptyAction"),
              onClick: () => fileInputRef.current?.click(),
              icon: "upload",
            }}
            icon="book-open"
          />
        ) : filteredDocs.length === 0 ? (
          <p className="text-[12px] text-text-muted">{td("noFilterMatch")}</p>
        ) : (
          view === "list" ? (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full text-[12px]">
                <thead className="border-b border-border bg-surface-2 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                  <tr>
                    <th className="w-8 px-3 py-2"></th>
                    <th className="px-3 py-2 text-left">{td("colTitle")}</th>
                    <th className="px-3 py-2 text-left">{td("colState")}</th>
                    <th className="px-3 py-2 text-left">{td("colChunks")}</th>
                    <th className="px-3 py-2 text-left">{td("colSize")}</th>
                    <th className="px-3 py-2 text-left">{td("colUpdated")}</th>
                    <th className="px-3 py-2 text-left">{td("colTags")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((d) => (
                    <DocRow
                      key={d.id}
                      kbId={kb.id}
                      doc={d}
                      selected={selected.has(d.id)}
                      onToggleSelect={() => toggleSelect(d.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredDocs.map((d) => (
                <DocCard
                  key={d.id}
                  kbId={kb.id}
                  doc={d}
                  selected={selected.has(d.id)}
                  onToggleSelect={() => toggleSelect(d.id)}
                  onReindex={() => void handleReindex(d)}
                />
              ))}
            </div>
          )
        )}
      </div>

      {error && (
        <div className="border-t border-danger/30 bg-danger-soft px-5 py-2 text-[11px] text-danger">
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 text-text-subtle hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      {showUrlIngest && (
        <UrlIngestModal
          kbId={kb.id}
          kbName={kb.name}
          onClose={() => setShowUrlIngest(false)}
          onIngested={async () => {
            setShowUrlIngest(false);
            await refreshDocs();
            await refreshKb();
          }}
          onError={setError}
        />
      )}

      {showBulkTag && (
        <BulkTagModal
          knownTags={knownTags}
          selectionCount={selected.size}
          onClose={() => setShowBulkTag(false)}
          onApply={applyBulkTags}
        />
      )}
    </div>
  );
}

// Doc card — link to L3 doc page; checkbox is overlay (hover to reveal).
function DocCard({
  kbId,
  doc,
  selected,
  onToggleSelect,
  onReindex,
}: {
  kbId: string;
  doc: DocumentDto;
  selected: boolean;
  onToggleSelect: () => void;
  onReindex: () => void;
}) {
  const t = useTranslations("knowledge.docs");
  return (
    <div
      className={`group relative rounded-xl border bg-surface p-4 transition duration-fast hover:border-border-strong ${
        selected ? "border-primary/40 bg-primary-muted/10" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        className={`absolute left-3 top-3 z-10 inline-flex h-4 w-4 items-center justify-center rounded border bg-surface transition ${
          selected
            ? "border-primary bg-primary text-primary-fg"
            : "border-border opacity-0 group-hover:opacity-100"
        }`}
        aria-label={t("selectAria")}
      >
        {selected ? <Icon name="check" size={11} /> : null}
      </button>
      <Link href={`/knowledge/${kbId}/docs/${doc.id}`} className="block pl-6">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-[13px] font-medium text-text">
            {doc.title}
          </h3>
          <StateBadge state={doc.state} />
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-text-subtle">
          <span>{t("chunkSummary", { chunks: doc.chunk_count, version: doc.version })}</span>
          <span>·</span>
          <span>{t("sizeKb", { kb: (doc.size_bytes / 1024).toFixed(1) })}</span>
        </div>
        {doc.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {doc.tags.map((tg) => (
              <span
                key={tg}
                className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-muted"
              >
                #{tg}
              </span>
            ))}
          </div>
        )}
      </Link>
      {doc.state === "failed" && (
        <button
          type="button"
          onClick={onReindex}
          className="mt-2 inline-flex h-6 items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-2 text-[10px] text-warning hover:bg-warning/10"
        >
          <Icon name="refresh" size={10} />
          {t("retryIngest")}
        </button>
      )}
    </div>
  );
}

// Compact list row for "list view" mode. Click row → L3 doc page.
function DocRow({
  kbId,
  doc,
  selected,
  onToggleSelect,
}: {
  kbId: string;
  doc: DocumentDto;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <tr
      className={`border-b border-border last:border-0 transition ${
        selected ? "bg-primary-muted/10" : "hover:bg-surface-2"
      }`}
    >
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={onToggleSelect}
          className={`inline-flex h-4 w-4 items-center justify-center rounded border bg-surface ${
            selected
              ? "border-primary bg-primary text-primary-fg"
              : "border-border"
          }`}
        >
          {selected ? <Icon name="check" size={11} /> : null}
        </button>
      </td>
      <td className="px-3 py-2">
        <Link
          href={`/knowledge/${kbId}/docs/${doc.id}`}
          className="line-clamp-1 text-[12px] font-medium text-text hover:text-primary"
        >
          {doc.title}
        </Link>
      </td>
      <td className="px-3 py-2">
        <StateBadge state={doc.state} />
      </td>
      <td className="px-3 py-2 font-mono text-[10px] text-text-subtle">
        {doc.chunk_count}
      </td>
      <td className="px-3 py-2 font-mono text-[10px] text-text-subtle">
        {(doc.size_bytes / 1024).toFixed(1)} KB
      </td>
      <td className="px-3 py-2 font-mono text-[10px] text-text-subtle">
        {new Date(doc.updated_at).toLocaleDateString()}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {doc.tags.slice(0, 3).map((tg) => (
            <span
              key={tg}
              className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-text-muted"
            >
              #{tg}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

function StateBadge({ state }: { state: string }) {
  const cls =
    state === "ready"
      ? "border-success/30 bg-success-soft text-success"
      : state === "failed"
        ? "border-danger/30 bg-danger-soft text-danger"
        : "border-warning/30 bg-warning-soft text-warning";
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 font-mono text-[9px] uppercase tracking-wide ${cls}`}
    >
      {state}
    </span>
  );
}

// AddDocumentMenu — split button: primary = file picker, chevron = URL.
// Lifted from old single page; needs popover-placement wiring per § 3.9.
function AddDocumentMenu({
  disabled,
  uploading,
  inputRef,
  onPickFiles,
  onPickUrl,
}: {
  disabled: boolean;
  uploading: boolean;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onPickFiles: (files: FileList) => void;
  onPickUrl: () => void;
}) {
  const t = useTranslations("knowledge.toolbar");
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setSide(computePopoverSide(rect, 80, window.innerHeight, "bottom"));
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <label
        className={`inline-flex h-9 items-center gap-1.5 rounded-l-xl px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm ${
          disabled
            ? "bg-primary opacity-40 cursor-not-allowed"
            : "bg-primary hover:bg-primary-hover cursor-pointer"
        }`}
      >
        <Icon name="upload" size={13} />
        {uploading ? t("uploading") : t("upload")}
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onPickFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </label>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center justify-center rounded-r-xl border-l border-primary-fg/20 px-2 text-primary-fg shadow-soft-sm ${
          disabled
            ? "bg-primary opacity-40 cursor-not-allowed"
            : "bg-primary hover:bg-primary-hover"
        }`}
      >
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div
          className={`absolute right-0 z-40 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg ${
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1"
          }`}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onPickUrl();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text hover:bg-surface-2"
          >
            <Icon name="link" size={13} className="text-text-subtle" />
            {t("ingestUrl")}
          </button>
        </div>
      )}
    </div>
  );
}

// Url ingest modal — kept inline here for now; could live in components/.
function UrlIngestModal({
  kbId,
  kbName,
  onClose,
  onIngested,
  onError,
}: {
  kbId: string;
  kbName: string;
  onClose: () => void;
  onIngested: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("knowledge.urlIngest");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      await ingestUrl(kbId, url.trim(), {
        title: title.trim() || undefined,
        tags: tagsRaw
          ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      });
      onIngested();
    } catch (e) {
      onError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title={t("title", { kb: kbName })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:text-text"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!url.trim() || submitting}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40"
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("fieldUrl")}>
          <input
            type="text"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("urlPlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
          <p className="mt-1 font-mono text-[10px] text-text-subtle">{t("urlHint")}</p>
        </Field>
        <Field label={t("fieldTitle")}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
        <Field label={t("fieldTags")}>
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder={t("tagsPlaceholder")}
            className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </Field>
      </div>
    </ModalShell>
  );
}

function BulkTagModal({
  knownTags,
  selectionCount,
  onClose,
  onApply,
}: {
  knownTags: string[];
  selectionCount: number;
  onClose: () => void;
  onApply: (add: string[], remove: string[]) => void | Promise<void>;
}) {
  const t = useTranslations("knowledge.bulkTags");
  const [intents, setIntents] = useState<Record<string, "add" | "remove" | null>>({});
  const [newRaw, setNewRaw] = useState("");

  const addList = [
    ...Object.entries(intents).filter(([, v]) => v === "add").map(([k]) => k),
    ...newRaw.split(",").map((s) => s.trim()).filter(Boolean),
  ];
  const removeList = Object.entries(intents)
    .filter(([, v]) => v === "remove")
    .map(([k]) => k);

  function cycle(tag: string) {
    setIntents((prev) => {
      const next = { ...prev };
      const cur = next[tag] ?? null;
      next[tag] = cur === null ? "add" : cur === "add" ? "remove" : null;
      return next;
    });
  }

  return (
    <ModalShell
      title={t("title", { count: selectionCount })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-[12px] text-text-muted hover:text-text"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void onApply(addList, removeList)}
            disabled={addList.length === 0 && removeList.length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40"
          >
            <Icon name="check" size={11} />
            {t("apply", { add: addList.length, remove: removeList.length })}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-[12px]">
        <p className="text-text-muted leading-relaxed">{t("intro")}</p>
        {knownTags.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
              {t("knownHeader")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {knownTags.map((tag) => {
                const intent = intents[tag] ?? null;
                const cls =
                  intent === "add"
                    ? "border-success/40 bg-success-soft text-success"
                    : intent === "remove"
                      ? "border-danger/40 bg-danger-soft text-danger"
                      : "border-border bg-surface-2 text-text-muted hover:text-text";
                const sym = intent === "add" ? "+" : intent === "remove" ? "−" : "·";
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => cycle(tag)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] ${cls}`}
                    title={t("cycleHint")}
                  >
                    <span className="font-bold">{sym}</span>
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 font-mono text-[10px] text-text-subtle">
              {t("legend")}
            </div>
          </div>
        )}
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
            {t("newHeader")}
          </div>
          <input
            type="text"
            value={newRaw}
            onChange={(e) => setNewRaw(e.target.value)}
            placeholder={t("newPlaceholder")}
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[12px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
      </div>
    </ModalShell>
  );
}

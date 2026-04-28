"use client";

/**
 * /knowledge/[kbId]/docs/[docId] · L3 single document page.
 *
 * Replaces the old DocDrawer slide-over. Full canvas + 320px side rail.
 * Tabs:
 *   Overview  — metadata + AI/manual tag editor (replaces "Info" in drawer)
 *   Original  — markdown rendering or pre text
 *   Chunks    — list of chunks with split-view: click a chunk → highlight
 *               the matching text on the right pane
 *
 * Side rail always-visible: tag editor + metadata + actions (delete/reindex).
 * Breadcrumb back to /knowledge/[kbId]/docs.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { Icon } from "@/components/ui/icon";
import { ErrorState, LoadingState } from "@/components/state";
import {
  type DocumentChunkDto,
  type DocumentDto,
  deleteDocument,
  getDocumentText,
  listDocumentChunks,
  listDocuments,
  patchDocumentTags,
  reindexDocument,
  suggestTagsForDocument,
} from "@/lib/kb-api";

type Tab = "overview" | "text" | "chunks";

export default function DocPage() {
  const params = useParams<{ kbId: string; docId: string }>();
  const kbId = params?.kbId ?? "";
  const docId = params?.docId ?? "";
  const router = useRouter();
  const t = useTranslations("knowledge.detail");
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("overview");
  const [doc, setDoc] = useState<DocumentDto | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [chunks, setChunks] = useState<DocumentChunkDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeChunkId, setActiveChunkId] = useState<number | null>(null);
  const textPaneRef = useRef<HTMLDivElement | null>(null);

  async function refreshDoc() {
    try {
      const list = await listDocuments(kbId, { limit: 200 });
      const found = list.find((d) => d.id === docId);
      if (!found) {
        setError(t("notFound"));
        return;
      }
      setDoc(found);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void refreshDoc();
    // Eagerly load text + chunks since the side rail / split view want them
    getDocumentText(kbId, docId)
      .then(setText)
      .catch(() => setText(""));
    listDocumentChunks(kbId, docId)
      .then(setChunks)
      .catch(() => setChunks([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, docId]);

  function highlightChunkInText(c: DocumentChunkDto) {
    setActiveChunkId(c.id);
    const root = textPaneRef.current;
    if (!root) return;
    const needle = c.text.slice(0, 40);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null = walker.nextNode();
    while (n) {
      if ((n.textContent ?? "").includes(needle)) {
        (n.parentElement as HTMLElement)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        (n.parentElement as HTMLElement)?.classList.add("kb-highlight");
        setTimeout(
          () =>
            (n!.parentElement as HTMLElement)?.classList.remove("kb-highlight"),
          1800,
        );
        return;
      }
      n = walker.nextNode();
    }
  }

  async function handleDelete() {
    if (!doc) return;
    if (!confirm(t("deleteConfirm", { title: doc.title }))) return;
    try {
      await deleteDocument(kbId, doc.id);
      router.push(`/knowledge/${kbId}/docs`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleReindex() {
    if (!doc) return;
    try {
      await reindexDocument(kbId, doc.id);
      await refreshDoc();
    } catch (e) {
      setError(String(e));
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState title={error} />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="p-6">
        <LoadingState title={t("loadingDoc")} />
      </div>
    );
  }

  const isMarkdown = isMarkdownLikely(doc.mime_type);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main canvas */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-border bg-surface px-6 py-3">
          <Link
            href={`/knowledge/${kbId}/docs`}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-text-subtle hover:text-text"
          >
            <Icon name="chevron-left" size={11} />
            {t("backToDocs")}
          </Link>
          <h1 className="mt-1 break-words text-[16px] font-semibold text-text">
            {doc.title}
          </h1>
          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-text-subtle">
            <span>{doc.mime_type}</span>
            <span>·</span>
            <span>v{doc.version}</span>
            <span>·</span>
            <span>{(doc.size_bytes / 1024).toFixed(1)} KB</span>
            <span>·</span>
            <span>
              {t("chunkCountLine", { count: doc.chunk_count })}
            </span>
            <span className="ml-2">
              <StateBadge state={doc.state} />
            </span>
          </div>
          {/* Tabs */}
          <nav className="mt-3 -mb-3 flex gap-1">
            {(
              [
                { id: "overview", label: t("tabOverview"), icon: "info" },
                { id: "text", label: t("tabText"), icon: "file" },
                {
                  id: "chunks",
                  label: t("tabChunks", { count: doc.chunk_count }),
                  icon: "list",
                },
              ] as const
            ).map((tt) => {
              const active = tt.id === tab;
              return (
                <button
                  key={tt.id}
                  type="button"
                  onClick={() => setTab(tt.id)}
                  className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-[12px] transition ${
                    active
                      ? "border-primary text-text"
                      : "border-transparent text-text-muted hover:text-text"
                  }`}
                >
                  <Icon name={tt.icon} size={12} />
                  {tt.label}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "overview" && (
            <div className="space-y-4 overflow-y-auto p-6 text-[12px] leading-relaxed">
              {doc.state_error && (
                <div className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-danger">
                  {doc.state_error}
                </div>
              )}
              <Section title={t("infoSectionBasic")}>
                <Row label={t("metaId")} value={doc.id} mono />
                <Row label={t("metaMime")} value={doc.mime_type} mono />
                <Row label={t("metaSource")} value={doc.source_type} mono />
                {doc.source_uri && (
                  <Row label={t("metaUri")} value={doc.source_uri} mono />
                )}
                <Row
                  label={t("metaCreated")}
                  value={new Date(doc.created_at).toLocaleString(locale)}
                />
                <Row
                  label={t("metaUpdated")}
                  value={new Date(doc.updated_at).toLocaleString(locale)}
                />
              </Section>
            </div>
          )}

          {tab === "text" && (
            <div ref={textPaneRef} className="h-full overflow-y-auto p-6">
              {text === null ? (
                <LoadingState title={t("loadingText")} />
              ) : text.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-text-muted">
                  {t("emptyText")}
                </div>
              ) : isMarkdown ? (
                <AgentMarkdown
                  content={text}
                  className="rounded-xl border border-border bg-surface-2 px-5 py-4 text-[13px] leading-relaxed"
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-surface-2 p-4 text-[12px] leading-relaxed text-text">
                  {text}
                </pre>
              )}
            </div>
          )}

          {tab === "chunks" && (
            <ChunksSplitView
              chunks={chunks}
              text={text}
              isMarkdown={isMarkdown}
              activeChunkId={activeChunkId}
              onPick={highlightChunkInText}
              textRef={textPaneRef}
            />
          )}
        </div>
      </div>

      {/* Side rail */}
      <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-surface-2 p-5 lg:block">
        <Section title={t("infoSectionTags")}>
          <DocTagsEditor
            doc={doc}
            kbId={kbId}
            onChanged={async () => {
              await refreshDoc();
            }}
          />
        </Section>

        <div className="mt-5">
          <Section title={t("actionsSection")}>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void handleReindex()}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] text-text hover:border-primary/40"
              >
                <Icon name="refresh" size={12} />
                {t("reindex")}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 text-[12px] text-danger hover:bg-danger/10"
              >
                <Icon name="trash-2" size={12} />
                {t("softDelete")}
              </button>
            </div>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function ChunksSplitView({
  chunks,
  text,
  isMarkdown,
  activeChunkId,
  onPick,
  textRef,
}: {
  chunks: DocumentChunkDto[] | null;
  text: string | null;
  isMarkdown: boolean;
  activeChunkId: number | null;
  onPick: (c: DocumentChunkDto) => void;
  textRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("knowledge.detail");
  if (chunks === null || text === null) {
    return (
      <div className="p-6">
        <LoadingState title={t("loadingChunks")} description={t("loadingChunksDesc")} />
      </div>
    );
  }
  if (chunks.length === 0) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-text-muted">
          {t("emptyChunks")}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-1 overflow-hidden lg:grid-cols-[minmax(280px,1fr)_2fr]">
      <ul className="min-h-0 space-y-2 overflow-y-auto border-r border-border bg-surface p-3">
        {chunks.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c)}
              className={`block w-full rounded-lg border p-2.5 text-left text-[11px] transition ${
                activeChunkId === c.id
                  ? "border-primary bg-primary-muted"
                  : "border-border bg-surface-2 hover:border-primary/40"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-text-subtle">
                <span className="rounded-md bg-primary-muted px-1.5 py-0.5 text-primary">
                  #{c.ordinal + 1}
                </span>
                {c.section_path && (
                  <span className="truncate">{c.section_path}</span>
                )}
                {c.page != null && (
                  <span className="ml-auto rounded-md border border-border bg-surface px-1.5 py-0.5">
                    p{c.page}
                  </span>
                )}
              </div>
              <p className="line-clamp-3 text-[11px] leading-snug text-text">
                {c.text}
              </p>
            </button>
          </li>
        ))}
      </ul>
      <div ref={textRef} className="min-h-0 overflow-y-auto p-6" id="doc-text-pane">
        {isMarkdown ? (
          <AgentMarkdown
            content={text}
            className="rounded-xl border border-border bg-surface-2 px-5 py-4 text-[13px] leading-relaxed"
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-surface-2 p-4 text-[12px] leading-relaxed text-text">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}

function DocTagsEditor({
  doc,
  kbId,
  onChanged,
}: {
  doc: DocumentDto;
  kbId: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("knowledge.docTags");
  const [pending, setPending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");

  const suggestionsToShow = useMemo(
    () => (pending ?? []).filter((p) => !doc.tags.includes(p)),
    [pending, doc.tags],
  );

  async function runSuggest() {
    setBusy(true);
    try {
      const tags = await suggestTagsForDocument(kbId, doc.id);
      setPending(tags);
    } finally {
      setBusy(false);
    }
  }
  async function applyTag(tag: string) {
    await patchDocumentTags(kbId, doc.id, { add: [tag] });
    setPending((prev) => prev?.filter((p) => p !== tag) ?? null);
    await onChanged();
  }
  async function applyAll() {
    if (suggestionsToShow.length === 0) return;
    await patchDocumentTags(kbId, doc.id, { add: suggestionsToShow });
    setPending(null);
    await onChanged();
  }
  async function removeTag(tag: string) {
    await patchDocumentTags(kbId, doc.id, { remove: [tag] });
    await onChanged();
  }
  async function submitAdding() {
    const tag = adding.trim();
    if (!tag) return;
    setAdding("");
    if (doc.tags.includes(tag)) return;
    await patchDocumentTags(kbId, doc.id, { add: [tag] });
    await onChanged();
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {doc.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface pl-2 pr-1 py-0.5 font-mono text-[10px] text-text-muted"
          >
            #{tag}
            <button
              type="button"
              onClick={() => void removeTag(tag)}
              className="text-text-subtle hover:text-danger"
              aria-label={t("removeAria", { tag })}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitAdding();
            }
          }}
          placeholder={t("addPlaceholder")}
          className="h-6 w-32 rounded-full border border-border bg-surface px-2 font-mono text-[10px] text-text placeholder:text-text-subtle focus:border-border-strong focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runSuggest()}
          disabled={busy}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 font-mono text-[10px] text-text-muted hover:border-primary/40 hover:text-primary disabled:opacity-40"
        >
          <Icon name="sparkles" size={10} />
          {busy ? t("suggesting") : t("suggestCta")}
        </button>
        {suggestionsToShow.length > 0 && (
          <>
            {suggestionsToShow.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => void applyTag(tag)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 bg-primary-muted px-2 py-0.5 font-mono text-[10px] text-primary hover:border-primary"
                title={t("acceptOneHint")}
              >
                + #{tag}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void applyAll()}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2 font-mono text-[10px] text-primary-fg hover:bg-primary-hover"
            >
              <Icon name="check" size={10} />
              {t("acceptAll", { count: suggestionsToShow.length })}
            </button>
          </>
        )}
      </div>
      {pending !== null && pending.length === 0 && suggestionsToShow.length === 0 && (
        <p className="font-mono text-[10px] text-text-subtle">
          {t("noSuggestions")}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-border-hairline py-1.5 last:border-0">
      <span className="text-text-subtle">{label}</span>
      <span
        className={`min-w-0 truncate text-right ${mono ? "font-mono text-[11px] text-text" : "text-text"}`}
      >
        {value}
      </span>
    </div>
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
      className={`inline-flex h-5 items-center rounded-full border px-2 font-mono text-[9px] uppercase tracking-wide ${cls}`}
    >
      {state}
    </span>
  );
}

function isMarkdownLikely(mime: string): boolean {
  const sub = mime.split("/").pop() ?? "";
  return /(markdown|^md$|^mdx$|plain|html)/.test(sub);
}

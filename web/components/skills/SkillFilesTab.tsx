"use client";

/**
 * SkillFilesTab · split pane for /skills/{id} Files tab.
 *
 *   ┌─────────────┬──────────────────────────────┐
 *   │  file tree  │  editor / viewer            │
 *   │  (col-4)    │  (col-8)                    │
 *   └─────────────┴──────────────────────────────┘
 *
 * - Tree pulls `?include_manifest=true` so SKILL.yaml + prompts/* are
 *   visible (default list endpoint hides them).
 * - Click a file → fetch content → CodeMirror editor (markdown / yaml /
 *   json / python syntax depending on extension).
 * - Save button flushes the editor's current value to PUT
 *   /files/content?path=…; success toast + refresh content. Failed write
 *   surfaces the backend error string.
 * - Builtin skill warning banner: source != github / market / local
 *   (i.e. shipped with the backend) → orange callout reminding edits
 *   take effect in memory but won't survive `git checkout`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import {
  type SkillFileContent,
  type SkillFileEntry,
  deleteSkillFile,
  listSkillFiles,
  readSkillFile,
  writeSkillFile,
} from "@/lib/skill-files-api";
import { LoadingState, ErrorState, EmptyState } from "@/components/state";
import {
  SkillFileEditor,
  type SkillFileEditorHandle,
} from "./SkillFileEditor";
import { SkillFileTree } from "./SkillFileTree";

type Props = {
  skillId: string;
  /** Source surfaces a "this is a builtin · git checkout will overwrite"
   * warning. Pass-through from the parent skill detail. */
  source: "builtin" | "github" | "market" | "local";
};

export function SkillFilesTab({ skillId, source }: Props) {
  const t = useTranslations("skills.detail.files");

  // ── tree state ─────────────────────────────────────────────────────
  const [files, setFiles] = useState<SkillFileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const refreshFiles = useCallback(async () => {
    try {
      setFilesError(null);
      const list = await listSkillFiles(skillId, { includeManifest: true });
      setFiles(list);
    } catch (e) {
      setFilesError(String(e));
      setFiles([]);
    }
  }, [skillId]);
  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  // ── selected file state ────────────────────────────────────────────
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<SkillFileContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<SkillFileEditorHandle>(null);

  const loadContent = useCallback(
    async (path: string) => {
      setContentLoading(true);
      setContentError(null);
      setSelectedPath(path);
      setDirty(false);
      setSaveStatus("idle");
      setSaveError(null);
      try {
        const c = await readSkillFile(skillId, path);
        setContent(c);
      } catch (e) {
        setContentError(String(e));
        setContent(null);
      } finally {
        setContentLoading(false);
      }
    },
    [skillId],
  );

  const onSave = useCallback(async () => {
    if (!content || !selectedPath || !content.editable) return;
    const next = editorRef.current?.getValue() ?? content.content;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await writeSkillFile(skillId, selectedPath, next);
      setContent(updated);
      setDirty(false);
      setSaveStatus("saved");
      // Bytes may have changed → refresh tree to update size column.
      void refreshFiles();
    } catch (e) {
      setSaveError(String(e));
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [content, selectedPath, skillId, refreshFiles]);

  const onDelete = useCallback(async () => {
    if (!selectedPath) return;
    if (!confirm(t("deleteConfirm", { path: selectedPath }))) return;
    try {
      await deleteSkillFile(skillId, selectedPath);
      setSelectedPath(null);
      setContent(null);
      void refreshFiles();
    } catch (e) {
      setSaveError(String(e));
    }
  }, [selectedPath, skillId, refreshFiles, t]);

  // Cmd/Ctrl+S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (dirty && content?.editable) {
          e.preventDefault();
          void onSave();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, content?.editable, onSave]);

  // ── Render ─────────────────────────────────────────────────────────
  if (files === null && !filesError) {
    return <LoadingState title={t("loading")} description={t("loadingHint")} />;
  }
  if (filesError) {
    return <ErrorState title={t("loadFailed", { error: filesError })} />;
  }

  const isBuiltin = source === "builtin";

  return (
    <div data-testid="tab-panel-files" className="flex flex-col gap-3">
      {isBuiltin && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12.5px] text-text"
        >
          <Icon name="alert-triangle" size={13} className="mt-0.5 shrink-0 text-warning" />
          <p className="flex-1">{t("builtinWarning")}</p>
        </div>
      )}

      <div className="grid grid-cols-12 gap-3 min-h-[60vh]">
        {/* Left · file tree */}
        <aside className="col-span-12 lg:col-span-4 rounded-lg border border-border bg-surface-2 p-2 max-h-[70vh] overflow-y-auto">
          {files && files.length === 0 ? (
            <EmptyState
              title={t("treeEmpty")}
              description={t("treeEmptyHint")}
            />
          ) : (
            <SkillFileTree
              files={files ?? []}
              selectedPath={selectedPath}
              onSelect={loadContent}
            />
          )}
        </aside>

        {/* Right · editor */}
        <main className="col-span-12 lg:col-span-8 flex flex-col gap-2 min-h-[60vh]">
          {!selectedPath ? (
            <EmptyState title={t("noSelection")} description={t("noSelectionHint")} />
          ) : contentLoading ? (
            <LoadingState title={t("loadingFile")} description={selectedPath} />
          ) : contentError ? (
            <ErrorState title={t("readFailed", { error: contentError })} />
          ) : content ? (
            <>
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                <Icon name="file" size={12} className="text-text-muted" />
                <span className="font-mono text-[12px] text-text">{content.relative_path}</span>
                <span className="font-mono text-[10.5px] text-text-subtle">
                  {content.encoding === "utf-8"
                    ? `${content.size_bytes} B · ${content.editable ? t("editable") : t("readOnly")}`
                    : t("binary")}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {saveStatus === "saved" && !dirty && (
                    <span className="text-[11px] text-success">{t("saved")}</span>
                  )}
                  {dirty && content.editable && (
                    <span className="text-[11px] text-warning">{t("unsaved")}</span>
                  )}
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={saving}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-mono text-[11px] text-text-muted hover:border-danger/50 hover:text-danger transition-[color,border-color]"
                    data-testid="skill-file-delete"
                    title={t("deleteTooltip")}
                  >
                    <Icon name="trash-2" size={11} />
                    {t("deleteBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={!dirty || !content.editable || saving}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded-md px-3 font-mono text-[11px] transition-[background-color,color]",
                      !dirty || !content.editable
                        ? "bg-surface-3 text-text-subtle"
                        : "bg-primary text-primary-fg hover:bg-primary-hover",
                    )}
                    data-testid="skill-file-save"
                  >
                    <Icon name="check" size={11} />
                    {saving ? t("saving") : t("saveBtn")}
                  </button>
                </div>
              </div>

              {saveError && (
                <div
                  data-testid="skill-file-save-error"
                  className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"
                >
                  {saveError}
                </div>
              )}

              {/* Editor */}
              {content.encoding === "binary" ? (
                <div className="flex-1 rounded-md border border-border bg-surface p-6 text-center text-[13px] text-text-muted">
                  {t("binaryNotPreviewable")}
                </div>
              ) : (
                <div className="flex-1 min-h-[400px]">
                  <SkillFileEditor
                    ref={editorRef}
                    path={content.relative_path}
                    initialContent={content.content}
                    readOnly={!content.editable}
                    onChange={() => {
                      if (!dirty) setDirty(true);
                      if (saveStatus === "saved") setSaveStatus("idle");
                    }}
                  />
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

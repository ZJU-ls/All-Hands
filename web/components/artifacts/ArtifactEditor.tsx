"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

/**
 * Lazy-loaded monaco editor wrapper.
 *
 * Why dynamic: monaco's bundle is ~800KB. We don't want to ship it on
 * the chat page if the user never opens an artifact in edit mode. The
 * dynamic import lands as a separate Next chunk; first edit click
 * pays the load, subsequent clicks are cached.
 */
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
      加载编辑器…
    </div>
  ),
});

type Lang =
  | "markdown"
  | "html"
  | "css"
  | "javascript"
  | "typescript"
  | "json"
  | "yaml"
  | "python"
  | "plaintext";

const _MIME_TO_LANG: Record<string, Lang> = {
  "text/markdown": "markdown",
  "text/html": "html",
  "text/css": "css",
  "application/javascript": "javascript",
  "text/javascript": "javascript",
  "application/typescript": "typescript",
  "application/json": "json",
  "text/x-yaml": "yaml",
  "application/x-yaml": "yaml",
  "text/x-python": "python",
};

export function pickEditorLanguage(kind: string, mime: string): Lang {
  // mime gives us the most reliable signal (text/markdown, application/json, …)
  const direct = _MIME_TO_LANG[mime];
  if (direct) return direct;
  if (kind === "markdown") return "markdown";
  if (kind === "html") return "html";
  if (kind === "data") return "json";
  if (kind === "mermaid") return "markdown"; // monaco has no mermaid; markdown is closest
  if (kind === "code") return "plaintext";
  return "plaintext";
}

export function ArtifactEditor({
  value,
  onChange,
  language,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  language: Lang;
  /** Cmd/Ctrl+S keyboard shortcut → trigger save. */
  onSubmit?: () => void;
  disabled?: boolean;
}) {
  // Capture latest onSubmit so the keybinding doesn't go stale across renders.
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  return (
    <MonacoEditor
      height="100%"
      language={language}
      value={value}
      theme="vs-dark"
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor, monaco) => {
        // Cmd/Ctrl + S → save (matches every editor on the planet)
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          submitRef.current?.();
        });
      }}
      options={{
        readOnly: disabled ?? false,
        fontSize: 12,
        lineNumbers: "on",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        renderWhitespace: "boundary",
        smoothScrolling: true,
        automaticLayout: true,
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}

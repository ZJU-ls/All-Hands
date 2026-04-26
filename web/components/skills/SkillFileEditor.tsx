"use client";

/**
 * SkillFileEditor · CodeMirror 6 editor for one skill file.
 *
 * Dynamic-imports `@uiw/react-codemirror` + the language extension so the
 * editor bundle (~150 kb gzip) only lands when the user actually opens
 * the Files tab. Falls back to a plain `<textarea>` while the dynamic
 * load is in flight — usable on flaky networks, no jank when CDN slow.
 *
 * Languages mapped from file extension:
 *   .md            → markdown
 *   .yaml / .yml   → yaml
 *   .json          → json
 *   .py            → python
 *   *              → no syntax highlighting (still works)
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from "react";

type Language = "markdown" | "yaml" | "json" | "python" | "none";

function languageFromPath(path: string): Language {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "md") return "markdown";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "json") return "json";
  if (ext === "py") return "python";
  return "none";
}

type Loaded = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CodeMirror: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extensions: any[];
};

async function loadCodeMirror(language: Language): Promise<Loaded> {
  const [{ default: CodeMirror }] = await Promise.all([
    import("@uiw/react-codemirror"),
  ]);
  const extensions: unknown[] = [];
  if (language === "markdown") {
    const m = await import("@codemirror/lang-markdown");
    extensions.push(m.markdown());
  } else if (language === "yaml") {
    const m = await import("@codemirror/lang-yaml");
    extensions.push(m.yaml());
  } else if (language === "json") {
    const m = await import("@codemirror/lang-json");
    extensions.push(m.json());
  } else if (language === "python") {
    const m = await import("@codemirror/lang-python");
    extensions.push(m.python());
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { CodeMirror, extensions: extensions as any[] };
}

export type SkillFileEditorHandle = {
  /** Imperative read so the parent's "Save" button can flush without
   * threading state through every keystroke. */
  getValue: () => string;
};

type Props = {
  path: string;
  initialContent: string;
  readOnly?: boolean;
  onChange?: (next: string) => void;
};

export const SkillFileEditor = forwardRef(function SkillFileEditor(
  { path, initialContent, readOnly, onChange }: Props,
  ref: ForwardedRef<SkillFileEditorHandle>,
) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [value, setValue] = useState(initialContent);
  const valueRef = useRef(initialContent);
  const language = useMemo(() => languageFromPath(path), [path]);

  // Reset content when switching files.
  useEffect(() => {
    setValue(initialContent);
    valueRef.current = initialContent;
  }, [initialContent, path]);

  // Lazy-load CodeMirror once per language.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const m = await loadCodeMirror(language);
        if (!cancelled) setLoaded(m);
      } catch {
        // network/offline — leave loaded null; we'll keep showing the
        // textarea fallback indefinitely (still functional).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  useImperativeHandle(ref, () => ({ getValue: () => valueRef.current }), []);

  const handleChange = (next: string) => {
    setValue(next);
    valueRef.current = next;
    onChange?.(next);
  };

  if (!loaded) {
    // Textarea fallback while CodeMirror loads / if it fails to load.
    return (
      <textarea
        data-testid="skill-file-editor-textarea"
        value={value}
        readOnly={readOnly}
        onChange={(e) => handleChange(e.target.value)}
        className="h-full w-full resize-none rounded-md border border-border bg-surface p-3 font-mono text-[12.5px] leading-relaxed text-text outline-none focus:border-primary"
      />
    );
  }

  const { CodeMirror, extensions } = loaded;
  return (
    <div data-testid="skill-file-editor-codemirror" className="h-full overflow-auto rounded-md border border-border bg-surface">
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: !readOnly,
          foldGutter: true,
          autocompletion: !readOnly,
        }}
        theme="light"
        style={{ fontSize: "12.5px" }}
      />
    </div>
  );
});

"use client";

/**
 * KeyboardShortcutsModal · global cheat-sheet, opened with `?` (Shift+/).
 *
 * Each row is a (label, keys[]) tuple. Keys render as styled <kbd>-like
 * pills. Keep the list tight — only document shortcuts that actually exist
 * in the shell (CmdK palette, Cmd+B sidebar, ?/Esc here). New shortcuts
 * added elsewhere should append here so users have one place to learn the
 * keyboard surface.
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

const MAC_KEY = "⌘";
const PC_KEY = "Ctrl";

function isMac() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return true;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border border-border bg-surface-2 px-1.5 font-mono text-[11px] text-text">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("shell.shortcuts");
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const meta = isMac() ? MAC_KEY : PC_KEY;
  const sections: { titleKey: string; rows: { label: string; keys: string[] }[] }[] = [
    {
      titleKey: "global",
      rows: [
        { label: t("openPalette"), keys: [meta, "K"] },
        { label: t("toggleSidebar"), keys: [meta, "B"] },
        { label: t("openHelp"), keys: ["?"] },
        { label: t("dismiss"), keys: ["Esc"] },
      ],
    },
    {
      titleKey: "navigation",
      rows: [
        { label: t("home"), keys: ["g", "h"] },
        { label: t("artifacts"), keys: ["g", "a"] },
        { label: t("employees"), keys: ["g", "e"] },
      ],
    },
  ];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className="fixed inset-0 z-[60] grid place-items-center bg-bg/60 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Icon name="command" size={16} className="text-text-muted" />
            <h2 className="text-sm font-semibold tracking-tight">{t("title")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-7 w-7 place-items-center rounded-lg text-text-subtle hover:bg-surface-2 hover:text-text transition duration-fast"
          >
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="space-y-5 px-5 py-4">
          {sections.map((s) => (
            <div key={s.titleKey}>
              <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-subtle">
                {t(`section.${s.titleKey}`)}
              </div>
              <ul className="space-y-1.5">
                {s.rows.map((r) => (
                  <li
                    key={r.label}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5"
                  >
                    <span className="text-sm text-text">{r.label}</span>
                    <span className="flex items-center gap-1">
                      {r.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <footer className="border-t border-border px-5 py-3 text-caption text-text-subtle">
          {t("footer")}
        </footer>
      </div>
    </div>
  );
}

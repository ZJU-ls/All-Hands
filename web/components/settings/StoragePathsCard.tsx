"use client";

/**
 * StoragePathsCard · 「存储位置」 settings panel.
 *
 * Lists every on-disk path the runtime is using (data dir / sqlite / installed
 * skills / built-in skills / artifacts) so the user can:
 *   • see at a glance where their state lives
 *   • copy the absolute path into a terminal / file-manager
 *   • (future · in desktop shell) click 「打开」 to reveal in Finder/Explorer
 *
 * Read-only on purpose. Configurable rows surface the env-var name so the
 * user knows how to override; we don't take edits inline because moving an
 * already-populated skills_dir / artifacts_dir live needs a content
 * migration that's out of scope for v0.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  listSystemPaths,
  openSystemPath,
  type SystemPathEntry,
} from "@/lib/system-api";

type Status = "loading" | "ok" | "error";

const KEY_ICON: Record<string, IconName> = {
  data_dir: "folder",
  database: "database",
  skills_dir: "wand-2",
  builtin_skills_dir: "shield-check",
  artifacts_dir: "file",
};

function iconFor(key: string): IconName {
  return KEY_ICON[key] ?? "folder";
}

export function StoragePathsCard() {
  const t = useTranslations("settings.storage");
  const [paths, setPaths] = useState<SystemPathEntry[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listSystemPaths();
        if (!cancelled) {
          setPaths(list);
          setStatus("ok");
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async (entry: SystemPathEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path);
      setCopied(entry.key);
      setTimeout(() => setCopied((c) => (c === entry.key ? null : c)), 1600);
    } catch {
      // clipboard denied — fall through silently; user can select+copy
    }
  };

  const handleOpen = async (entry: SystemPathEntry) => {
    const res = await openSystemPath(entry.path);
    if (res.status === "ok") {
      setOpened(entry.key);
      setTimeout(() => setOpened((o) => (o === entry.key ? null : o)), 1600);
    } else if (res.status === "unsupported") {
      // No desktop bridge → fall back to copy + hint.
      void handleCopy(entry);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name="folder" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold tracking-tight text-text">{t("title")}</h3>
          <p className="mt-1 text-caption leading-relaxed text-text-muted">
            {t("subtitle")}
          </p>

          <div className="mt-4 space-y-2">
            {status === "loading" ? (
              <div className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-3 text-caption text-text-muted">
                {t("loading")}
              </div>
            ) : status === "error" ? (
              <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-caption text-danger">
                {t("loadFailed", { error: error ?? "" })}
              </div>
            ) : (
              paths.map((entry) => (
                <div
                  key={entry.key}
                  className="rounded-lg border border-border bg-surface-2/40 px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface text-text-muted">
                      <Icon name={iconFor(entry.key)} size={13} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[13px] font-semibold text-text">
                          {entry.label}
                        </span>
                        {entry.builtin ? (
                          <span className="rounded bg-text-subtle/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                            {t("readonly")}
                          </span>
                        ) : null}
                        {entry.configurable && entry.env_var ? (
                          <code className="rounded bg-primary-muted px-1.5 py-0.5 font-mono text-[10px] text-primary">
                            {entry.env_var}
                          </code>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
                        {entry.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-[11px] text-text">
                          {entry.path || t("notSet")}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopy(entry)}
                          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] text-text-muted hover:border-border-strong hover:text-text"
                          title={t("copyTitle")}
                        >
                          <Icon
                            name={copied === entry.key ? "check" : "copy"}
                            size={11}
                          />
                          {copied === entry.key ? t("copied") : t("copy")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpen(entry)}
                          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] text-text-muted hover:border-border-strong hover:text-text"
                          title={t("openTitle")}
                        >
                          <Icon name="arrow-right" size={11} />
                          {opened === entry.key ? t("opened") : t("open")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-text-subtle">
            {t("footnote")}
          </p>
        </div>
      </div>
    </section>
  );
}

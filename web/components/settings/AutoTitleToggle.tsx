"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { fetchSystemFlags, patchSystemFlags } from "@/lib/observatory-api";

export function AutoTitleToggle() {
  const t = useTranslations("settings");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSystemFlags()
      .then((f) => {
        if (!cancelled) setEnabled(Boolean(f.auto_title_enabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = async () => {
    if (enabled === null || saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      const res = await patchSystemFlags({ auto_title_enabled: next });
      setEnabled(Boolean(res.auto_title_enabled));
    } catch {
      setError(t("autoTitleError"));
    } finally {
      setSaving(false);
    }
  };

  const status =
    saving
      ? t("autoTitleSaving")
      : enabled
        ? t("autoTitleOn")
        : t("autoTitleOff");

  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-soft-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name="sparkles" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold tracking-tight text-text">
            {t("autoTitle")}
          </h3>
          <p className="mt-1 text-caption leading-relaxed text-text-muted">
            {t("autoTitleDescription")}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={enabled === true}
              disabled={enabled === null || saving}
              onClick={onToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${
                enabled
                  ? "border-primary/40 bg-primary"
                  : "border-border bg-surface-2"
              } ${enabled === null || saving ? "opacity-60" : ""}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-soft-sm transition ${
                  enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="text-caption text-text-muted">{status}</span>
            {error ? (
              <span className="text-caption text-danger">{error}</span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { LOCALES, type Locale } from "@/i18n/config";
import { setLocaleAction } from "@/i18n/actions";

/**
 * Topbar / settings locale switcher. Mirrors ThemeToggle style.
 * Mode `compact` = icon-only dropdown (topbar). Mode `full` = labelled
 * radio-style list (settings page).
 */
export function LocaleSwitcher({ mode = "compact" }: { mode?: "compact" | "full" }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("locale");
  const tShell = useTranslations("shell.topbar");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function pick(next: Locale) {
    if (next === locale) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
      setOpen(false);
    });
  }

  if (mode === "full") {
    return (
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("label")}>
        {LOCALES.map((code) => {
          const active = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(code)}
              disabled={pending}
              className={
                active
                  ? "flex h-10 items-center justify-between rounded-lg border border-primary bg-primary-muted px-3 text-sm text-text"
                  : "flex h-10 items-center justify-between rounded-lg border border-border bg-surface px-3 text-sm text-text-muted hover:border-border-strong hover:text-text transition duration-base"
              }
            >
              <span>{t(code)}</span>
              {active && <Icon name="check" size={14} />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text transition duration-base disabled:opacity-50"
        aria-label={tShell("languageAria")}
        title={tShell("languageTitle")}
      >
        <Icon name="languages" size={15} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-11 z-50 min-w-[160px] overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg">
            {LOCALES.map((code) => {
              const active = code === locale;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => pick(code)}
                  className={
                    active
                      ? "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-text bg-surface-2"
                      : "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast"
                  }
                >
                  <span>{t(code)}</span>
                  {active && <Icon name="check" size={14} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { LOCALES, type Locale } from "@/i18n/config";
import { setLocaleAction } from "@/i18n/actions";

/**
 * Topbar / settings locale switcher. Mirrors ThemeToggle style.
 * Mode `compact` = icon-only dropdown (topbar). Mode `full` = labelled
 * radio-style list (settings page).
 *
 * Compact-mode menu is portaled to <body> so it escapes the topbar's
 * stacking context (the right DrawerRail uses z-30 in a parent layer and
 * was eating the menu otherwise).
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
    <CompactSwitcher
      open={open}
      setOpen={setOpen}
      pending={pending}
      locale={locale}
      tShell={tShell}
      t={t}
      pick={pick}
    />
  );
}

type Translator = ReturnType<typeof useTranslations>;

function CompactSwitcher({
  open,
  setOpen,
  pending,
  locale,
  tShell,
  t,
  pick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  pending: boolean;
  locale: Locale;
  tShell: Translator;
  t: Translator;
  pick: (l: Locale) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    const recompute = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Anchor under the button, right-aligned.
      setCoords({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface text-text-muted hover:border-border-strong hover:text-text transition duration-base disabled:opacity-50"
        aria-label={tShell("languageAria")}
        title={tShell("languageTitle")}
      >
        <Icon name="languages" size={15} />
      </button>
      {open && mounted && coords
        ? createPortal(
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[1000] cursor-default"
              />
              <div
                role="menu"
                style={{ top: coords.top, right: coords.right }}
                className="fixed z-[1001] min-w-[160px] overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg"
              >
                {LOCALES.map((code) => {
                  const active = code === locale;
                  return (
                    <button
                      key={code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
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
            </>,
            document.body,
          )
        : null}
    </>
  );
}

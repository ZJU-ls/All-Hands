/**
 * allhands · i18n config
 *
 * Locale-as-cookie strategy (no URL segment) — see CLAUDE.md §3.8 / theme
 * pack pattern: switching writes a cookie; the server reads it on next
 * request and sets <html lang>. Avoids /[locale]/... routing churn across
 * 42 pages and stays compatible with App Router static segments.
 */

export const LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-CN";

export const LOCALE_COOKIE = "allhands_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Pick the first acceptable locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const tags = acceptLanguage
    .split(",")
    .map((s) => s.trim().split(";")[0]?.toLowerCase() ?? "");
  for (const tag of tags) {
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

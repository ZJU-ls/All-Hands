import { cookies, headers } from "next/headers";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from "./config";

/**
 * Server-side locale resolution + message loading for next-intl.
 *
 * Locale: cookie → Accept-Language → DEFAULT_LOCALE.
 *
 * Messages: the catalog lives in `messages/<locale>.json` (the core / shared
 * keys) PLUS `messages/<locale>/*.json` (per-area extensions). Each extension
 * file becomes a top-level key namespace so different parts of the app can
 * own their JSON without merge conflicts. We deep-merge with the core file
 * winning on conflicts.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale: Locale | undefined = isLocale(cookieLocale) ? cookieLocale : undefined;
  if (!locale) {
    const headerStore = await headers();
    locale = negotiateLocale(headerStore.get("accept-language"));
  }
  if (!locale) locale = DEFAULT_LOCALE;

  const messages = await loadMessages(locale);
  return { locale, messages };
});

async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  const root = join(process.cwd(), "i18n", "messages");
  const core = (await import(`./messages/${locale}.json`)).default as Record<string, unknown>;

  // Collect per-namespace files under messages/<locale>/*.json
  let extras: Record<string, unknown> = {};
  try {
    const dir = join(root, locale);
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await readFile(join(dir, file), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      extras = { ...extras, ...parsed };
    }
  } catch {
    // No per-namespace dir yet — that's fine.
  }

  // Core wins so the foundational catalog stays authoritative if a namespace
  // file accidentally redefines a shared key.
  return { ...extras, ...core };
}

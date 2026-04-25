import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from "./config";

/**
 * Server-side locale resolution for next-intl.
 *
 * Order: explicit cookie → Accept-Language negotiation → DEFAULT_LOCALE.
 * No URL segment is used (see config.ts comment).
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale = isLocale(cookieLocale) ? cookieLocale : undefined;
  if (!locale) {
    const headerStore = await headers();
    locale = negotiateLocale(headerStore.get("accept-language"));
  }
  if (!locale) locale = DEFAULT_LOCALE;

  const messages = (await import(`./messages/${locale}.json`)).default;
  return { locale, messages };
});

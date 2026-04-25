import type { ReactElement, ReactNode } from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import zhCNCore from "@/i18n/messages/zh-CN.json";

/**
 * Eagerly load every per-namespace JSON under `i18n/messages/zh-CN/` so test
 * components rendered through this wrapper resolve every key the production
 * runtime would. We can't `await import()` synchronously inside a test, so
 * read-and-parse at module load — the file count is tiny.
 */
function loadAllMessages(): Record<string, unknown> {
  const root = join(process.cwd(), "i18n", "messages", "zh-CN");
  let extras: Record<string, unknown> = {};
  try {
    for (const file of readdirSync(root)) {
      if (!file.endsWith(".json")) continue;
      const raw = readFileSync(join(root, file), "utf8");
      extras = { ...extras, ...(JSON.parse(raw) as Record<string, unknown>) };
    }
  } catch {
    // No per-namespace dir yet — fine.
  }
  return { ...extras, ...zhCNCore };
}

const MESSAGES = loadAllMessages();

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="zh-CN" messages={MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}

/**
 * Drop-in replacement for `render` from @testing-library/react that wraps
 * the rendered tree in `NextIntlClientProvider` populated with the real
 * zh-CN catalog. Existing test code can switch over by changing
 *
 *   import { render } from "@testing-library/react";
 *
 * to
 *
 *   import { render } from "@/tests/test-utils/i18n-render";
 *
 * Everything else (`screen`, `fireEvent`, etc.) continues to come from
 * @testing-library/react via the re-export below.
 */
export function renderWithI18n(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, { wrapper: I18nWrapper, ...options });
}

// Re-export everything from @testing-library/react EXCEPT `render`, then
// override `render` below so test files importing `render` from this module
// transparently pick up the i18n wrapper.
export {
  act,
  cleanup,
  configure,
  createEvent,
  fireEvent,
  getNodeText,
  getQueriesForElement,
  getRoles,
  isInaccessible,
  logRoles,
  prettyDOM,
  prettyFormat,
  queries,
  queryHelpers,
  renderHook,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";

export const render = renderWithI18n;


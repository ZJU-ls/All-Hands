import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import zhCN from "@/i18n/messages/zh-CN.json";

/**
 * Render a component wrapped in `NextIntlClientProvider` so any
 * `useTranslations` hook inside resolves against the real zh-CN catalog.
 *
 * Use this in component tests instead of the bare `render` from
 * `@testing-library/react`. Assertions that match Chinese strings keep
 * working unchanged.
 */
export function renderWithI18n(ui: ReactElement, options?: RenderOptions) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="zh-CN" messages={zhCN}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

"use client";

/**
 * allhands · ThemeProvider
 *
 * Thin wrapper around `next-themes` that:
 *   - Applies `.light` / `.dark` class on <html> (tailwind darkMode: 'class').
 *   - Stores preference in localStorage under `allhands_theme`.
 *   - Respects `prefers-color-scheme` when "system" is active.
 *   - Exposes a back-compat `useTheme()` with `{ theme, set, toggle }` so
 *     existing call sites don't churn.
 *
 * Theme pack (brand-blue by default) is a separate axis set on <html>
 * via `data-theme-pack` in layout.tsx. When additional packs arrive,
 * add pack switching here via `setThemePack` and update the attribute.
 *
 * See: product/adr/0016-brand-blue-dual-theme.md §D4 · §D7
 */

import {
  ThemeProvider as NextThemeProvider,
  useTheme as useNextTheme,
} from "next-themes";

export type ThemeMode = "light" | "dark";
export type ThemePreference = ThemeMode | "system";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      themes={["light", "dark"]}
      storageKey="allhands_theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}

/**
 * Back-compat hook matching the pre-0016 ThemeProvider shape.
 *
 * `theme` is the *resolved* mode ("light" | "dark"), never "system" —
 * callers that render theme-conditional UI want the concrete color scheme.
 * `preference` is the raw setting (may be "system"); use it for the toggle
 * UI when you need to show which option the user picked.
 */
export function useTheme() {
  const { resolvedTheme, setTheme, theme } = useNextTheme();

  const resolved: ThemeMode =
    resolvedTheme === "light" ? "light" : "dark";

  return {
    theme: resolved,
    preference: (theme ?? "system") as ThemePreference,
    set: (t: ThemePreference) => setTheme(t),
    toggle: () => setTheme(resolved === "dark" ? "light" : "dark"),
  };
}

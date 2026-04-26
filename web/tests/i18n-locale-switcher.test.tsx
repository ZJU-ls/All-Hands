/**
 * LocaleSwitcher · contract tests.
 *
 * Covers:
 *  - Compact mode renders the toggle button with the correct aria-label.
 *  - Full mode renders both locales as radios; the active one is checked.
 *  - Picking the same locale closes the menu without firing setLocaleAction.
 *  - Picking a different locale calls setLocaleAction(<code>) and refresh().
 *
 * Doesn't cover the portal positioning math (jsdom can't measure layout).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils/i18n-render";

const setLocaleSpy = vi.fn<(locale: string) => Promise<void>>(async () => {});
const refreshSpy = vi.fn();

vi.mock("@/i18n/actions", () => ({
  setLocaleAction: (locale: string) => setLocaleSpy(locale),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshSpy }),
}));

import { LocaleSwitcher } from "@/components/locale/LocaleSwitcher";

beforeEach(() => {
  setLocaleSpy.mockClear();
  refreshSpy.mockClear();
});

describe("LocaleSwitcher · full mode", () => {
  it("renders both locales as radios with the active one checked", () => {
    render(<LocaleSwitcher mode="full" />);
    const zh = screen.getByRole("radio", { name: /简体中文/ });
    const en = screen.getByRole("radio", { name: /English/ });
    expect(zh).toBeDefined();
    expect(en).toBeDefined();
    // Default render in tests uses zh-CN catalog → zh active.
    expect(zh.getAttribute("aria-checked")).toBe("true");
    expect(en.getAttribute("aria-checked")).toBe("false");
  });

  it("picking the active locale does not call setLocaleAction", () => {
    render(<LocaleSwitcher mode="full" />);
    fireEvent.click(screen.getByRole("radio", { name: /简体中文/ }));
    expect(setLocaleSpy).not.toHaveBeenCalled();
  });

  it("picking the inactive locale calls setLocaleAction(en) and refresh()", async () => {
    render(<LocaleSwitcher mode="full" />);
    fireEvent.click(screen.getByRole("radio", { name: /English/ }));
    await waitFor(() => expect(setLocaleSpy).toHaveBeenCalledWith("en"));
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledOnce());
  });
});

describe("LocaleSwitcher · compact mode", () => {
  it("renders a single toggle button with the language aria label", () => {
    render(<LocaleSwitcher mode="compact" />);
    const btn = screen.getByRole("button", { name: /切换语言/ });
    expect(btn).toBeDefined();
  });
});

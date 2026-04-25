/**
 * Welcome page · first-run greeting.
 *
 * Contract:
 *   - Renders hero + CTA on mount.
 *   - "开始使用" marks first-run completed and routes to /chat.
 *   - "稍后再说" marks first-run completed and routes to /.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@/tests/test-utils/i18n-render";

import WelcomePage, { FIRST_RUN_SCOPE } from "../page";
import { hasCompletedFirstRun } from "@/lib/first-run";
import { renderWithI18n as render } from "@/tests/test-utils/i18n-render";

const replaceSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceSpy, push: replaceSpy }),
}));

function clearAllKeys() {
  const ls = window.localStorage;
  const keys: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k) keys.push(k);
  }
  for (const k of keys) ls.removeItem(k);
}

beforeEach(() => {
  replaceSpy.mockReset();
  clearAllKeys();
});

afterEach(cleanup);

describe("WelcomePage", () => {
  it("renders the hero, three highlights, and primary CTA", () => {
    render(<WelcomePage />);
    expect(screen.getByTestId("welcome-page")).toBeDefined();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "欢迎来到 allhands。",
    );
    // 3 highlight cards live as h3 (the section above them owns the h2).
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("welcome-start")).toBeDefined();
    expect(screen.getByTestId("welcome-skip")).toBeDefined();
  });

  it("clicking 开始使用 marks first-run completed and routes to /chat", () => {
    render(<WelcomePage />);
    fireEvent.click(screen.getByTestId("welcome-start"));
    expect(hasCompletedFirstRun(FIRST_RUN_SCOPE)).toBe(true);
    expect(replaceSpy).toHaveBeenCalledWith("/chat");
  });

  it("clicking 稍后再说 still marks first-run completed (one-shot greeting)", () => {
    render(<WelcomePage />);
    fireEvent.click(screen.getByTestId("welcome-skip"));
    expect(hasCompletedFirstRun(FIRST_RUN_SCOPE)).toBe(true);
    expect(replaceSpy).toHaveBeenCalledWith("/");
  });
});

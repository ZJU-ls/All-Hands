/**
 * I-0014 · Coachmark component integration with first-run store.
 *
 * Two behaviours matter for UX:
 *   1. First visit: coachmark renders.
 *   2. After dismiss: coachmark is gone AND stays gone on remount.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@/tests/test-utils/i18n-render";
import { Coachmark } from "../components/ui/Coachmark";
import { markCoachmarkSeen } from "../lib/first-run";

describe("Coachmark", () => {
  beforeEach(() => {
    const ls = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  });

  it("renders on first mount when the id has not been seen", async () => {
    render(<Coachmark id="test-overview" title="这里是驾驶舱" />);
    // useEffect reveal — flush effects.
    await act(async () => {});
    expect(screen.getByText("这里是驾驶舱")).toBeTruthy();
  });

  it("stays hidden when the id was already dismissed", async () => {
    markCoachmarkSeen("test-overview");
    render(<Coachmark id="test-overview" title="这里是驾驶舱" />);
    await act(async () => {});
    expect(screen.queryByText("这里是驾驶舱")).toBeNull();
  });

  it("clicking dismiss hides it and persists 'seen'", async () => {
    render(<Coachmark id="test-overview" title="这里是驾驶舱" />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "关闭引导" }));
    });
    expect(screen.queryByText("这里是驾驶舱")).toBeNull();
    expect(window.localStorage.getItem("coachmark:seen:test-overview")).toBe(
      "1",
    );
  });

  it("uses verb-first dismiss label '知道了' (not 确定/OK)", async () => {
    render(<Coachmark id="vt-check" title="T" />);
    await act(async () => {});
    expect(screen.getByText("知道了")).toBeTruthy();
  });
});

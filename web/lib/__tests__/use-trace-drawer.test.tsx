import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const mockReplace = vi.fn();
let mockParams = new URLSearchParams();
let mockPathname = "/chat/abc";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockParams,
}));

import { useTraceDrawer } from "../use-trace-drawer";

afterEach(() => {
  mockReplace.mockReset();
  mockParams = new URLSearchParams();
  mockPathname = "/chat/abc";
});

describe("useTraceDrawer", () => {
  it("returns runId=null when ?trace is absent", () => {
    const { result } = renderHook(() => useTraceDrawer());
    expect(result.current.runId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("reads ?trace from the URL and exposes it as runId/isOpen", () => {
    mockParams = new URLSearchParams("trace=run_abc");
    const { result } = renderHook(() => useTraceDrawer());
    expect(result.current.runId).toBe("run_abc");
    expect(result.current.isOpen).toBe(true);
  });

  it("open(id) router.replaces with ?trace=<id> · scroll: false", () => {
    const { result } = renderHook(() => useTraceDrawer());
    act(() => result.current.open("run_xyz"));
    expect(mockReplace).toHaveBeenCalledWith("/chat/abc?trace=run_xyz", {
      scroll: false,
    });
  });

  it("open() preserves other existing query params", () => {
    mockParams = new URLSearchParams("tab=details&foo=bar");
    const { result } = renderHook(() => useTraceDrawer());
    act(() => result.current.open("run_xyz"));
    const target = mockReplace.mock.calls[0]?.[0] as string;
    expect(target).toContain("/chat/abc?");
    expect(target).toContain("tab=details");
    expect(target).toContain("foo=bar");
    expect(target).toContain("trace=run_xyz");
  });

  it("close() removes ?trace · keeps siblings · scroll: false", () => {
    mockParams = new URLSearchParams("trace=run_abc&tab=details");
    const { result } = renderHook(() => useTraceDrawer());
    act(() => result.current.close());
    expect(mockReplace).toHaveBeenCalledWith("/chat/abc?tab=details", {
      scroll: false,
    });
  });

  it("close() with no other params yields a bare pathname (no trailing ?)", () => {
    mockParams = new URLSearchParams("trace=run_abc");
    const { result } = renderHook(() => useTraceDrawer());
    act(() => result.current.close());
    expect(mockReplace).toHaveBeenCalledWith("/chat/abc", {
      scroll: false,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunDetailDto } from "@/lib/observatory-api";

const { routerReplaceMock, searchParamsRef } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams("") as URLSearchParams },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => searchParamsRef.current,
}));

const { fetchRunDetailMock } = vi.hoisted(() => ({
  fetchRunDetailMock: vi.fn(),
}));

vi.mock("@/lib/observatory-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/observatory-api")>(
      "@/lib/observatory-api",
    );
  return {
    ...actual,
    fetchRunDetail: fetchRunDetailMock,
  };
});

import { RunTraceDrawer } from "../RunTraceDrawer";

function makeRun(over: Partial<RunDetailDto> = {}): RunDetailDto {
  return {
    run_id: "run_drawer",
    task_id: null,
    conversation_id: "conv_1",
    employee_id: null,
    employee_name: null,
    status: "succeeded",
    started_at: "2026-04-21T00:00:00Z",
    finished_at: "2026-04-21T00:00:02Z",
    duration_s: 2,
    tokens: { prompt: 1, completion: 1, total: 2 },
    error: null,
    turns: [],
    ...over,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  routerReplaceMock.mockReset();
  fetchRunDetailMock.mockReset();
  searchParamsRef.current = new URLSearchParams("");
});
afterEach(cleanup);

describe("RunTraceDrawer", () => {
  it("renders nothing when the `trace` query param is absent", () => {
    render(<RunTraceDrawer />);
    expect(screen.queryByTestId("run-trace-drawer")).toBeNull();
  });

  it("opens when ?trace=<run_id> is present and fetches the detail", async () => {
    searchParamsRef.current = new URLSearchParams("trace=run_drawer");
    fetchRunDetailMock.mockResolvedValue(makeRun());
    render(<RunTraceDrawer />);
    await flush();
    expect(screen.getByTestId("run-trace-drawer")).toBeDefined();
    expect(fetchRunDetailMock).toHaveBeenCalledWith("run_drawer");
  });

  it("close button strips the trace param so the drawer dismisses on next render", async () => {
    searchParamsRef.current = new URLSearchParams("trace=run_drawer&foo=bar");
    fetchRunDetailMock.mockResolvedValue(makeRun());
    render(<RunTraceDrawer />);
    await flush();

    fireEvent.click(screen.getByTestId("run-trace-drawer-close"));

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/tasks?foo=bar",
      expect.objectContaining({ scroll: false }),
    );
  });
});

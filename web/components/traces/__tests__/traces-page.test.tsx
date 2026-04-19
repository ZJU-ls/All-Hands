/**
 * /traces page · regression suite (track-g)
 *
 * Covers the DoD from the track prompt:
 *   1. LoadingState while the first fetch is in-flight.
 *   2. ErrorState when fetchTraces rejects on first load.
 *   3. EmptyState when the filtered result set is empty.
 *   4. Sort toggle on tokens column swaps row order.
 *   5. Row click opens the detail drawer and the Langfuse external link.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ObservatorySummaryDto, TraceSummaryDto } from "@/lib/observatory-api";
import type { EmployeeDto } from "@/lib/api";

vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { fetchTracesMock, fetchSummaryMock, listEmployeesMock } = vi.hoisted(() => ({
  fetchTracesMock: vi.fn(),
  fetchSummaryMock: vi.fn(),
  listEmployeesMock: vi.fn(),
}));

vi.mock("@/lib/observatory-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/observatory-api")>(
      "@/lib/observatory-api",
    );
  return {
    ...actual,
    fetchTraces: fetchTracesMock,
    fetchObservatorySummary: fetchSummaryMock,
  };
});

vi.mock("@/lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listEmployees: listEmployeesMock,
  };
});

function makeTrace(over: Partial<TraceSummaryDto> = {}): TraceSummaryDto {
  return {
    trace_id: over.trace_id ?? "tr_1",
    employee_id: over.employee_id ?? "emp_1",
    employee_name: over.employee_name ?? "writer",
    status: over.status ?? "ok",
    duration_s: over.duration_s ?? 1.2,
    tokens: over.tokens ?? 1500,
    started_at: over.started_at ?? "2026-04-19T12:00:00Z",
  };
}

function makeSummary(over: Partial<ObservatorySummaryDto> = {}): ObservatorySummaryDto {
  return {
    traces_total: 2,
    failure_rate_24h: 0,
    latency_p50_s: 0,
    avg_tokens_per_run: 0,
    by_employee: [],
    observability_enabled: true,
    bootstrap_status: "ok",
    bootstrap_error: null,
    host: "https://lf.example",
    ...over,
  };
}

beforeEach(() => {
  fetchTracesMock.mockReset();
  fetchSummaryMock.mockReset();
  listEmployeesMock.mockReset();
  fetchSummaryMock.mockResolvedValue(makeSummary());
  listEmployeesMock.mockResolvedValue([
    { id: "emp_1", name: "writer" } as EmployeeDto,
  ]);
});

afterEach(() => {
  cleanup();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("/traces page", () => {
  it("shows LoadingState before the first fetch resolves", async () => {
    let resolve: (v: { traces: TraceSummaryDto[]; count: number }) => void = () =>
      undefined;
    fetchTracesMock.mockImplementation(
      () =>
        new Promise<{ traces: TraceSummaryDto[]; count: number }>((res) => {
          resolve = res;
        }),
    );
    const { default: Page } = await import("../../../app/traces/page");
    render(<Page />);

    expect(screen.getByRole("status")).toBeDefined();

    await act(async () => {
      resolve({
        traces: [makeTrace({ trace_id: "tr_a" })],
        count: 1,
      });
    });
    await flush();

    expect(screen.getByText("tr_a")).toBeDefined();
  });

  it("shows ErrorState when the first fetch rejects", async () => {
    fetchTracesMock.mockRejectedValue(new Error("500 offline"));
    const { default: Page } = await import("../../../app/traces/page");
    render(<Page />);
    await flush();

    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.getByText("追踪列表加载失败")).toBeDefined();
  });

  it("renders EmptyState when the API returns no traces", async () => {
    fetchTracesMock.mockResolvedValue({ traces: [], count: 0 });
    const { default: Page } = await import("../../../app/traces/page");
    render(<Page />);
    await flush();

    expect(screen.getByText("当前过滤下没有 trace")).toBeDefined();
  });

  it("toggles sort on tokens column · click flips order", async () => {
    fetchTracesMock.mockResolvedValue({
      traces: [
        makeTrace({
          trace_id: "tr_small",
          tokens: 100,
          started_at: "2026-04-19T12:00:00Z",
        }),
        makeTrace({
          trace_id: "tr_big",
          tokens: 9000,
          started_at: "2026-04-19T11:00:00Z",
        }),
      ],
      count: 2,
    });
    const { default: Page } = await import("../../../app/traces/page");
    render(<Page />);
    await flush();

    const dataRows = (): HTMLTableRowElement[] =>
      Array.from(
        document.querySelectorAll<HTMLTableRowElement>("tbody tr"),
      );

    // default sort: started_at desc → tr_small first.
    expect(dataRows()[0]?.textContent).toContain("tr_small");

    // click tokens header → desc (big first).
    const tokensBtn = screen.getByLabelText("按 tokens 排序");
    await act(async () => {
      fireEvent.click(tokensBtn);
    });
    expect(dataRows()[0]?.textContent).toContain("tr_big");

    // click again → asc (small first).
    await act(async () => {
      fireEvent.click(tokensBtn);
    });
    expect(dataRows()[0]?.textContent).toContain("tr_small");
  });

  it("opens the detail drawer with a Langfuse external link", async () => {
    fetchTracesMock.mockResolvedValue({
      traces: [
        makeTrace({ trace_id: "tr_open", status: "failed" }),
      ],
      count: 1,
    });
    fetchSummaryMock.mockResolvedValue(makeSummary({ host: "https://lf.example" }));
    const { default: Page } = await import("../../../app/traces/page");
    render(<Page />);
    await flush();
    // summary fires after first paint — give it an extra turn.
    await flush();

    const row = document.querySelector<HTMLTableRowElement>("tbody tr");
    expect(row).not.toBeNull();
    await act(async () => {
      fireEvent.click(row!);
    });

    expect(screen.getByRole("dialog")).toBeDefined();
    const link = screen.getByText("在 Langfuse 中查看完整 trace").closest("a");
    expect(link).toBeDefined();
    expect(link?.getAttribute("href")).toBe("https://lf.example/trace/tr_open");
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});

/**
 * I-0006 regression · Cockpit consumes /api/cockpit/stream via EventSource
 * instead of the old 5s polling loop.
 *
 * The test stubs EventSource + `cockpitStreamUrl` / `getCockpitSummary`, drives
 * snapshot + activity frames, and asserts that:
 *   1. Before the first snapshot lands, the LoadingState renders (role=status).
 *   2. After a snapshot frame, the cockpit body renders summary data.
 *   3. An activity frame prepends an entry to the feed (no polling round-trip).
 *   4. An SSE error surfaces ErrorState with a retry action.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";

// ---------- module mocks ---------------------------------------------------

vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));
vi.mock("@/components/cockpit/ActivityFeed", () => ({
  ActivityFeed: ({ events }: { events: { id: string; summary: string }[] }) => (
    <ul data-testid="feed">
      {events.map((e) => (
        <li key={e.id}>{e.summary}</li>
      ))}
    </ul>
  ),
}));
vi.mock("@/components/cockpit/ActiveRunsList", () => ({
  ActiveRunsList: () => <div data-testid="runs" />,
}));
vi.mock("@/components/cockpit/RecentConvList", () => ({
  RecentConvList: () => <div data-testid="convs" />,
}));
vi.mock("@/components/cockpit/HealthPanel", () => ({
  HealthPanel: () => <div data-testid="health" />,
}));
vi.mock("@/components/cockpit/KpiBar", () => ({
  KpiBar: () => <div data-testid="kpi" />,
}));
vi.mock("@/components/cockpit/QuickActions", () => ({
  QuickActions: () => <div data-testid="qa" />,
}));
vi.mock("@/components/cockpit/BudgetSummary", () => ({
  BudgetSummary: () => <div data-testid="budget" />,
}));

const { getSummaryMock } = vi.hoisted(() => ({ getSummaryMock: vi.fn() }));
vi.mock("@/lib/cockpit-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cockpit-api")>(
    "@/lib/cockpit-api",
  );
  return {
    ...actual,
    getCockpitSummary: getSummaryMock,
    cockpitStreamUrl: () => "/api/cockpit/stream",
    pauseAllRuns: vi.fn(),
    resumeAllRuns: vi.fn(),
  };
});

// ---------- EventSource stub ----------------------------------------------

type Handler = (evt: MessageEvent | Event) => void;
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, Handler[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: Handler) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: Handler) {
    const arr = this.listeners[type];
    if (!arr) return;
    this.listeners[type] = arr.filter((h) => h !== handler);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload?: unknown) {
    const evt = new MessageEvent(type, { data: JSON.stringify(payload ?? {}) });
    (this.listeners[type] ?? []).forEach((h) => h(evt));
  }
  emitError() {
    (this.listeners.error ?? []).forEach((h) => h(new Event("error")));
  }
}

// ---------- helpers --------------------------------------------------------

function makeSnapshot(overrides: Partial<WorkspaceSummaryDto> = {}): WorkspaceSummaryDto {
  return {
    employees_total: 3,
    runs_active: 1,
    conversations_today: 2,
    artifacts_total: 5,
    artifacts_this_week_delta: 1,
    triggers_active: 0,
    tasks_active: 0,
    tasks_needs_user: 0,
    tokens_today_total: 0,
    tokens_today_prompt: 0,
    tokens_today_completion: 0,
    estimated_cost_today_usd: 0,
    health: {
      gateway: { name: "gateway", status: "ok", detail: null },
      mcp_servers: { name: "mcp", status: "ok", detail: null },
      langfuse: { name: "langfuse", status: "ok", detail: null },
      db: { name: "db", status: "ok", detail: null },
      triggers: { name: "triggers", status: "ok", detail: null },
    },
    confirmations_pending: 0,
    runs_failing_recently: 0,
    recent_events: [
      {
        id: "evt_1",
        ts: "2026-04-19T12:00:00Z",
        kind: "run.started",
        actor: "emp_1",
        subject: null,
        summary: "Lead 开始调度",
        severity: "info",
        link: null,
      },
    ],
    active_runs: [],
    recent_conversations: [],
    paused: false,
    paused_reason: null,
    paused_at: null,
    ...overrides,
  };
}

// ---------- test setup -----------------------------------------------------

const originalES = globalThis.EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  getSummaryMock.mockReset();
  // @ts-expect-error — jsdom ships no EventSource
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  cleanup();
  if (originalES) {
    globalThis.EventSource = originalES;
  } else {
    // @ts-expect-error — drop the stub
    delete globalThis.EventSource;
  }
});

// ---------- tests ----------------------------------------------------------

describe("Cockpit · SSE consumer (I-0006)", () => {
  it("shows LoadingState before snapshot, hydrates after", async () => {
    let resolveSummary: (s: WorkspaceSummaryDto) => void = () => undefined;
    getSummaryMock.mockImplementation(
      () =>
        new Promise<WorkspaceSummaryDto>((res) => {
          resolveSummary = res;
        }),
    );

    const { Cockpit } = await import("../Cockpit");
    render(<Cockpit />);

    // Before any summary resolves: LoadingState is up (role=status).
    expect(screen.getByRole("status")).toBeDefined();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("/api/cockpit/stream");

    // Snapshot frame arrives via the SSE stream.
    const snap = makeSnapshot();
    await act(async () => {
      FakeEventSource.instances[0]!.emit("snapshot", snap);
      // also resolve the inflight /summary fetch for cleanup
      resolveSummary(snap);
    });

    expect(screen.getByTestId("feed")).toBeDefined();
    expect(screen.getByText("Lead 开始调度")).toBeDefined();
  });

  it("prepends activity events to the feed", async () => {
    getSummaryMock.mockResolvedValue(makeSnapshot());
    const { Cockpit } = await import("../Cockpit");
    render(<Cockpit />);

    await act(async () => {
      FakeEventSource.instances[0]!.emit("snapshot", makeSnapshot());
    });

    await act(async () => {
      FakeEventSource.instances[0]!.emit("activity", {
        id: "evt_new",
        kind: "conv.created",
        ts: "2026-04-19T12:05:00Z",
        payload: { summary: "用户开了新对话", severity: "info" },
      });
    });

    const feed = screen.getByTestId("feed");
    const items = feed.querySelectorAll("li");
    expect(items[0]?.textContent).toBe("用户开了新对话");
  });

  it("surfaces ErrorState when the stream errors out before a snapshot", async () => {
    getSummaryMock.mockRejectedValue(new Error("offline"));
    const { Cockpit } = await import("../Cockpit");
    render(<Cockpit />);

    await act(async () => {
      FakeEventSource.instances[0]!.emitError();
    });

    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.getByText("驾驶舱加载失败")).toBeDefined();
    expect(screen.getByText("实时连接中断")).toBeDefined();
  });

  it("never uses setInterval polling", async () => {
    getSummaryMock.mockResolvedValue(makeSnapshot());
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { Cockpit } = await import("../Cockpit");
    render(<Cockpit />);
    await act(async () => {
      FakeEventSource.instances[0]!.emit("snapshot", makeSnapshot());
    });
    // Cockpit proper must not install any interval timer.
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});

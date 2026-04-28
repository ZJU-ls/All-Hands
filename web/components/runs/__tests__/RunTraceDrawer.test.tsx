import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@/tests/test-utils/i18n-render";

const mockClose = vi.fn();
let mockState = { runId: "run_xyz", isOpen: true };

vi.mock("@/lib/use-trace-drawer", () => ({
  useTraceDrawer: () => ({
    runId: mockState.runId,
    isOpen: mockState.isOpen,
    open: vi.fn(),
    close: mockClose,
  }),
  TRACE_QUERY_KEY: "trace",
}));

vi.mock("../RunTracePanel", () => ({
  RunTracePanel: ({ runId }: { runId?: string }) => (
    <div data-testid="run-trace-panel-stub">{runId}</div>
  ),
}));

vi.mock("@/lib/observatory-api", () => ({
  fetchRunDetail: vi.fn(),
  RunNotFoundError: class extends Error {},
}));

import { RunTraceDrawer } from "../RunTraceDrawer";

afterEach(() => {
  cleanup();
  mockClose.mockReset();
  mockState = { runId: "run_xyz", isOpen: true };
});

describe("RunTraceDrawer", () => {
  it("renders nothing when the drawer is closed", () => {
    mockState = { runId: null as unknown as string, isOpen: false };
    const { container } = render(<RunTraceDrawer />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mounts a dialog + overlay + RunTracePanel for the active runId", () => {
    render(<RunTraceDrawer />);
    expect(screen.getByTestId("run-trace-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("run-trace-drawer-overlay")).toBeInTheDocument();
    const panel = screen.getByTestId("run-trace-panel-stub");
    expect(panel.textContent).toBe("run_xyz");
  });

  it("clicking the overlay calls close()", () => {
    render(<RunTraceDrawer />);
    fireEvent.click(screen.getByTestId("run-trace-drawer-overlay"));
    expect(mockClose).toHaveBeenCalled();
  });

  it("clicking the ✕ button calls close()", () => {
    render(<RunTraceDrawer />);
    fireEvent.click(screen.getByTestId("run-trace-drawer-close"));
    expect(mockClose).toHaveBeenCalled();
  });

  it("Escape key calls close()", () => {
    render(<RunTraceDrawer />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockClose).toHaveBeenCalled();
  });

  it("the 全屏看 link points to the observatory L3 page for this runId", () => {
    render(<RunTraceDrawer />);
    const fullscreen = screen.getByTestId("run-trace-drawer-fullscreen");
    expect(fullscreen.getAttribute("href")).toBe(
      "/observatory/runs/run_xyz",
    );
  });

  it("Escape inside an input does NOT close the drawer (defer to default)", () => {
    render(
      <>
        <RunTraceDrawer />
        <input data-testid="probe" />
      </>,
    );
    const input = screen.getByTestId("probe");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(mockClose).not.toHaveBeenCalled();
  });
});

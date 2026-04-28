import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@/tests/test-utils/i18n-render";
import { TraceChip, traceHref, TRACE_QUERY_KEY } from "../TraceChip";

const mockReplace = vi.fn();
const mockOpen = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  );
  return {
    ...actual,
    useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
    usePathname: () => "/chat/abc",
    useSearchParams: () => mockSearchParams,
  };
});

vi.mock("@/lib/use-trace-drawer", () => ({
  useTraceDrawer: () => ({
    runId: null,
    isOpen: false,
    open: mockOpen,
    close: vi.fn(),
  }),
  TRACE_QUERY_KEY: "trace",
}));

afterEach(() => {
  cleanup();
  mockReplace.mockReset();
  mockOpen.mockReset();
  mockSearchParams = new URLSearchParams();
});

describe("TraceChip", () => {
  it("still exports the legacy query key (read by /traces and cockpit list)", () => {
    expect(TRACE_QUERY_KEY).toBe("trace");
  });

  it("traceHref points to the observatory L3 page and url-encodes the id", () => {
    expect(traceHref("run_abc")).toBe("/observatory/runs/run_abc");
    expect(traceHref("run with space")).toBe(
      "/observatory/runs/run%20with%20space",
    );
  });

  it("default chip variant opens the drawer · does not navigate", () => {
    render(<TraceChip runId="run_abc" />);
    const chip = screen.getByTestId("trace-chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("data-variant")).toBe("chip");
    expect(chip.getAttribute("data-run-id")).toBe("run_abc");
    fireEvent.click(chip);
    expect(mockOpen).toHaveBeenCalledWith("run_abc");
  });

  it("link variant opens the drawer with arrow glyph (in-page peek)", () => {
    render(<TraceChip runId="run_link" variant="link" label="查看" />);
    const chip = screen.getByTestId("trace-chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.textContent).toContain("查看");
    expect(chip.textContent).toContain("↗");
    fireEvent.click(chip);
    expect(mockOpen).toHaveBeenCalledWith("run_link");
  });

  it("page variant keeps the legacy <Link> navigation (cockpit / observatory)", () => {
    render(<TraceChip runId="run_page" variant="page" />);
    const chip = screen.getByTestId("trace-chip");
    expect(chip.tagName).toBe("A");
    expect(chip.getAttribute("href")).toBe("/observatory/runs/run_page");
    fireEvent.click(chip);
    // Page variant must NOT call into the drawer hook.
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

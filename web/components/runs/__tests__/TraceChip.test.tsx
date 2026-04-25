import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@/tests/test-utils/i18n-render";
import { TraceChip, TRACE_QUERY_KEY } from "../TraceChip";

const { routerReplaceMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(""),
}));

beforeEach(() => routerReplaceMock.mockReset());
afterEach(cleanup);

describe("TraceChip", () => {
  it("exports the shared query key used by the drawer", () => {
    expect(TRACE_QUERY_KEY).toBe("trace");
  });

  it("pushes ?trace=<run_id> onto the current route without scroll reset", () => {
    render(<TraceChip runId="run_abc" />);
    fireEvent.click(screen.getByTestId("trace-chip"));
    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/tasks?trace=run_abc",
      expect.objectContaining({ scroll: false }),
    );
  });

  it("stops event propagation so parent row links don't fire", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <TraceChip runId="run_xyz" />
      </div>,
    );
    fireEvent.click(screen.getByTestId("trace-chip"));
    expect(parentClick).not.toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledTimes(1);
  });

  it("supports a `link` variant with arrow glyph", () => {
    render(<TraceChip runId="run_link" variant="link" label="查看" />);
    const chip = screen.getByTestId("trace-chip");
    expect(chip.textContent).toContain("查看");
    expect(chip.textContent).toContain("↗");
  });
});

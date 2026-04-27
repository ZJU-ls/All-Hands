import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@/tests/test-utils/i18n-render";
import { TraceChip, traceHref, TRACE_QUERY_KEY } from "../TraceChip";

afterEach(cleanup);

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

  it("renders an anchor that links to the observatory L3 trace page", () => {
    render(<TraceChip runId="run_abc" />);
    const chip = screen.getByTestId("trace-chip");
    expect(chip.tagName).toBe("A");
    expect(chip.getAttribute("href")).toBe("/observatory/runs/run_abc");
    expect(chip.getAttribute("data-run-id")).toBe("run_abc");
  });

  it("supports a `link` variant with arrow glyph", () => {
    render(<TraceChip runId="run_link" variant="link" label="查看" />);
    const chip = screen.getByTestId("trace-chip");
    expect(chip.tagName).toBe("A");
    expect(chip.textContent).toContain("查看");
    expect(chip.textContent).toContain("↗");
    expect(chip.getAttribute("href")).toBe("/observatory/runs/run_link");
  });
});

/**
 * RenderSlot contract tests — the single boundary between untrusted
 * LLM-produced render envelopes and the React component tree.
 *
 * Three responsibilities, three test groups:
 * 1. Known component name → dispatches with normalized props.
 * 2. Unknown component name → inline "unknown" chip (no crash).
 * 3. Component throws mid-render → inline "render failed" chip (no crash,
 *    other messages in the same bubble keep rendering).
 *
 * The error-boundary branch was added to guard against the runtime
 * `Cannot read properties of undefined (reading 'map')` crash that took
 * down the whole chat view when a single render payload was malformed.
 */

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen } from "@/tests/test-utils/i18n-render";
import type { RenderPayload } from "@/lib/protocol";
import { RenderSlot } from "../RenderSlot";
import { registerComponent } from "@/lib/component-registry";

beforeAll(() => {
  // Register a deliberately-throwing component so we can exercise the boundary.
  function Boom(): React.ReactElement {
    throw new Error("intentional");
  }
  try {
    registerComponent("Test.Boom", Boom);
  } catch {
    /* idempotent across hot reload */
  }

  // Register a minimal passthrough so the happy-path test is independent of
  // the real Viz.* modules (which dynamic-import and race against the test).
  function Echo(props: { props: Record<string, unknown> }) {
    return <div data-testid="echo">{JSON.stringify(props.props)}</div>;
  }
  try {
    registerComponent("Test.Echo", Echo);
  } catch {
    /* idempotent */
  }
});

afterEach(cleanup);

describe("RenderSlot", () => {
  it("dispatches to a registered component with normalized props", () => {
    const payload: RenderPayload = {
      component: "Test.Echo",
      props: { a: 1 },
      interactions: [],
    };
    render(<RenderSlot payload={payload} />);
    expect(screen.getByTestId("echo").textContent).toBe('{"a":1}');
  });

  it("shows inline placeholder when component is not in the registry", () => {
    const payload: RenderPayload = {
      component: "Does.Not.Exist",
      props: {},
      interactions: [],
    };
    render(<RenderSlot payload={payload} />);
    expect(screen.getByTestId("render-slot-unknown")).toBeDefined();
    expect(screen.getByText(/Does\.Not\.Exist/)).toBeDefined();
  });

  it("shows inline crash card when a component throws mid-render", () => {
    // Silence the dev-console breadcrumb during this test
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload: RenderPayload = {
      component: "Test.Boom",
      props: {},
      interactions: [],
    };
    render(<RenderSlot payload={payload} />);
    const slot = screen.getByTestId("render-slot-crash");
    expect(slot.getAttribute("data-component")).toBe("Test.Boom");
    expect(slot.textContent).toMatch(/intentional/);
    errSpy.mockRestore();
  });

  it("normalizes null props / interactions without crashing", () => {
    // Simulate a malformed wire payload (null where arrays / objects are
    // expected). Cast via unknown since this shape is intentionally off-spec.
    const payload = {
      component: "Test.Echo",
      props: null,
      interactions: null,
    } as unknown as RenderPayload;
    expect(() => render(<RenderSlot payload={payload} />)).not.toThrow();
    // props default to {} so Echo renders an empty JSON object
    expect(screen.getByTestId("echo").textContent).toBe("{}");
  });
});

/**
 * DrawerRail · right-edge rail + lazy drawer mount gate.
 *
 * Contract (L08 — drawer module never loads until the user opens one):
 *   1. Rail buttons for health / budget / convs exist and are labelled.
 *   2. Before first open, the drawer is NOT in the DOM.
 *   3. Clicking a rail button opens the drawer with the matching panel.
 *   4. ESC closes the drawer; clicking the active button again toggles it
 *      closed (pressed semantics).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@/tests/test-utils/i18n-render";
import type { WorkspaceSummaryDto } from "@/lib/cockpit-api";
import { DrawerRail } from "../DrawerRail";

// next/dynamic returns a component lazy-loaded via import(). For unit tests
// we resolve it synchronously against the actual CockpitDrawer module so the
// drawer is mounted as soon as DrawerRail's `mountedOnce` gate flips true —
// L08's dynamic contract is still enforced, we just skip the network hop.
vi.mock("next/dynamic", async () => {
  const mod = await vi.importActual<
    typeof import("@/components/cockpit/CockpitDrawer")
  >("@/components/cockpit/CockpitDrawer");
  return {
    default: () => mod.CockpitDrawer,
  };
});

function makeSummary(overrides: Partial<WorkspaceSummaryDto> = {}): WorkspaceSummaryDto {
  return {
    employees_total: 1,
    runs_active: 0,
    conversations_today: 0,
    artifacts_total: 0,
    artifacts_this_week_delta: 0,
    triggers_active: 0,
    tasks_active: 0,
    tasks_needs_user: 0,
    tokens_today_total: 1234,
    tokens_today_prompt: 1000,
    tokens_today_completion: 234,
    estimated_cost_today_usd: 0.12,
    health: {
      gateway: { name: "gateway", status: "ok", detail: null },
      mcp_servers: { name: "mcp", status: "ok", detail: null },
      langfuse: { name: "langfuse", status: "ok", detail: null },
      db: { name: "db", status: "ok", detail: null },
      triggers: { name: "triggers", status: "ok", detail: null },
    },
    confirmations_pending: 0,
    runs_failing_recently: 0,
    recent_events: [],
    active_runs: [],
    recent_conversations: [
      {
        id: "c1",
        employee_id: "e1",
        employee_name: "Lead",
        title: "hello",
        updated_at: new Date().toISOString(),
        message_count: 3,
      },
    ],
    paused: false,
    paused_reason: null,
    paused_at: null,
    ...overrides,
  };
}

describe("DrawerRail", () => {
  it("renders all rail buttons and the observatory link", () => {
    render(<DrawerRail summary={makeSummary()} />);
    expect(screen.getByTestId("rail-health")).toBeDefined();
    expect(screen.getByTestId("rail-budget")).toBeDefined();
    expect(screen.getByTestId("rail-convs")).toBeDefined();
    expect(screen.getByTestId("rail-observatory")).toBeDefined();
  });

  it("does not render any drawer until the user opens one", () => {
    render(<DrawerRail summary={makeSummary()} />);
    expect(screen.queryByTestId("cockpit-drawer-health")).toBeNull();
    expect(screen.queryByTestId("cockpit-drawer-budget")).toBeNull();
    expect(screen.queryByTestId("cockpit-drawer-convs")).toBeNull();
  });

  it("opens the matching drawer on click and toggles closed when clicked again", async () => {
    render(<DrawerRail summary={makeSummary()} />);
    const healthBtn = screen.getByTestId("rail-health");

    fireEvent.click(healthBtn);
    await waitFor(() => {
      expect(screen.getByTestId("cockpit-drawer-health")).toBeDefined();
    });
    expect(healthBtn.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(healthBtn);
    await waitFor(() => {
      expect(screen.queryByTestId("cockpit-drawer-health")).toBeNull();
    });
  });

  it("closes the drawer on ESC", async () => {
    render(<DrawerRail summary={makeSummary()} />);
    fireEvent.click(screen.getByTestId("rail-budget"));
    await waitFor(() => {
      expect(screen.getByTestId("cockpit-drawer-budget")).toBeDefined();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("cockpit-drawer-budget")).toBeNull();
    });
  });

  it("close button in drawer header dismisses the drawer", async () => {
    render(<DrawerRail summary={makeSummary()} />);
    fireEvent.click(screen.getByTestId("rail-convs"));
    await waitFor(() => {
      expect(screen.getByTestId("cockpit-drawer-convs")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cockpit-drawer-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("cockpit-drawer-convs")).toBeNull();
    });
  });

  it("health rail shows a warn badge when any component is non-ok", () => {
    render(
      <DrawerRail
        summary={makeSummary({
          health: {
            gateway: { name: "gateway", status: "ok", detail: null },
            mcp_servers: { name: "mcp", status: "degraded", detail: "slow" },
            langfuse: { name: "langfuse", status: "down", detail: "unreachable" },
            db: { name: "db", status: "ok", detail: null },
            triggers: { name: "triggers", status: "ok", detail: null },
          },
        })}
      />,
    );
    const btn = screen.getByTestId("rail-health");
    // Badge text carries the count of non-ok components (2 here).
    expect(btn.textContent).toContain("2");
  });
});

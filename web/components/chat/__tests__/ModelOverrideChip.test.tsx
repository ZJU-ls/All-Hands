/**
 * ModelOverrideChip — Track ζ per-conversation model override control.
 *
 * Covers:
 *   - Chip renders employee's model_ref when no override is set (inherit state)
 *   - Clicking the chip opens the popover + shows the inherit option
 *   - Selecting a model sends PATCH with `model_ref_override` and lifts the
 *     updated conversation to the parent (this is the contract with the
 *     chat page).
 *   - Selecting the inherit option sends PATCH with `clear_model_ref_override`
 *     so the backend wipes the override rather than setting "".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ModelOverrideChip } from "../ModelOverrideChip";
import { invalidateModelPickerCache } from "@/components/model-picker/ModelPicker";
import type { ConversationDto, EmployeeDto } from "@/lib/api";

const providers = [
  {
    id: "p1",
    name: "OpenRouter",
    kind: "openai" as const,
    base_url: "https://openrouter.ai",
    default_model: "gpt-4o-mini",
    is_default: true,
    enabled: true,
  },
  {
    id: "p2",
    name: "Anthropic",
    kind: "anthropic" as const,
    base_url: "https://api.anthropic.com",
    default_model: "claude-opus-4-7",
    is_default: false,
    enabled: true,
  },
];

const models = [
  {
    id: "m1",
    provider_id: "p1",
    name: "gpt-4o-mini",
    display_name: "GPT 4o Mini",
    context_window: 128000,
    enabled: true,
  },
  {
    id: "m2",
    provider_id: "p2",
    name: "claude-opus-4-7",
    display_name: "Claude Opus 4.7",
    context_window: 200000,
    enabled: true,
  },
];

const employee: EmployeeDto = {
  id: "emp1",
  name: "lead",
  description: "",
  system_prompt: "",
  is_lead_agent: true,
  tool_ids: [],
  skill_ids: [],
  max_iterations: 10,
  model_ref: "OpenRouter/gpt-4o-mini",
  status: "published",
  published_at: "2026-04-18T00:00:00Z",
};

function makeConv(overrides: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id: "conv-1",
    employee_id: "emp1",
    title: null,
    model_ref_override: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const fetchMock = vi.fn();
let lastPatchBody: unknown = null;

beforeEach(() => {
  fetchMock.mockReset();
  lastPatchBody = null;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith("/api/providers")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(providers),
      } as Response);
    }
    if (url.endsWith("/api/models")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(models),
      } as Response);
    }
    if (url.includes("/api/conversations/") && init?.method === "PATCH") {
      const body = init.body ? JSON.parse(init.body as string) : {};
      lastPatchBody = body;
      const nextOverride =
        body.clear_model_ref_override === true
          ? null
          : typeof body.model_ref_override === "string"
            ? body.model_ref_override
            : null;
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            id: "conv-1",
            employee_id: "emp1",
            title: body.title ?? null,
            model_ref_override: nextOverride,
            created_at: new Date().toISOString(),
          }),
      } as Response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  // ModelPicker caches providers/models at module scope — reset between tests
  // so the stubbed fetch is actually hit on each render.
  invalidateModelPickerCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  invalidateModelPickerCache();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ModelOverrideChip (L11 · one-click picker)", () => {
  it("shows the employee default and no override dot when not overridden", async () => {
    render(
      <ModelOverrideChip
        conversation={makeConv()}
        employee={employee}
        onConversationChange={() => {}}
      />,
    );
    await flush();
    const chip = screen.getByTestId("model-override-chip");
    expect(chip.textContent).toContain("gpt-4o-mini");
    expect(screen.queryByTestId("model-override-dot")).toBeNull();
  });

  it("shows the override value + dot when set", async () => {
    render(
      <ModelOverrideChip
        conversation={makeConv({ model_ref_override: "Anthropic/claude-opus-4-7" })}
        employee={employee}
        onConversationChange={() => {}}
      />,
    );
    await flush();
    const chip = screen.getByTestId("model-override-chip");
    expect(chip.textContent).toContain("claude-opus-4-7");
    expect(screen.getByTestId("model-override-dot")).toBeTruthy();
  });

  it("opens the listbox with ONE click (no nested popover)", async () => {
    render(
      <ModelOverrideChip
        conversation={makeConv()}
        employee={employee}
        onConversationChange={() => {}}
      />,
    );
    await flush();
    // There should be no `model-override-popover` element — the chip is the
    // trigger now. Clicking it directly reveals the listbox.
    expect(screen.queryByTestId("model-override-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("model-override-chip"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("patches with model_ref_override on a single click + pick", async () => {
    const onChange = vi.fn();
    render(
      <ModelOverrideChip
        conversation={makeConv()}
        employee={employee}
        onConversationChange={onChange}
      />,
    );
    await flush();

    fireEvent.click(screen.getByTestId("model-override-chip"));
    await act(async () => {
      fireEvent.mouseDown(screen.getByText("Claude Opus 4.7"));
    });
    await flush();

    expect(lastPatchBody).toEqual({ model_ref_override: "Anthropic/claude-opus-4-7" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.model_ref_override).toBe(
      "Anthropic/claude-opus-4-7",
    );
  });

  it("patches with clear_model_ref_override when 'inherit' is picked", async () => {
    const onChange = vi.fn();
    render(
      <ModelOverrideChip
        conversation={makeConv({ model_ref_override: "Anthropic/claude-opus-4-7" })}
        employee={employee}
        onConversationChange={onChange}
      />,
    );
    await flush();

    fireEvent.click(screen.getByTestId("model-override-chip"));
    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId("model-picker-inherit"));
    });
    await flush();

    expect(lastPatchBody).toEqual({ clear_model_ref_override: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.model_ref_override).toBeNull();
  });
});

/**
 * ModelPicker — auto-default + inherit-entry contract (Track δ).
 *
 * Covers:
 *   - When `value` is empty and a default provider+model exists, ModelPicker
 *     bubbles the default model ref up via onChange (so the form saves
 *     meaningful state without the user touching the dropdown).
 *   - When `inheritLabel` is set, the "inherit" sentinel option is rendered
 *     with an empty value — this is what Track ζ will use for per-conversation
 *     overrides.
 *   - When `autoPickDefault` is false, no spontaneous onChange is fired.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@/tests/test-utils/i18n-render";

import { ModelPicker, invalidateModelPickerCache } from "../ModelPicker";

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
    name: "Bailian",
    kind: "aliyun" as const,
    base_url: "https://dashscope.aliyuncs.com",
    default_model: "qwen-plus",
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
    name: "qwen-plus",
    display_name: "Qwen Plus",
    context_window: 128000,
    enabled: true,
  },
];

const fetchMock = vi.fn();

beforeEach(() => {
  invalidateModelPickerCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
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
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function flush() {
  // Two microtask flushes: one for listProviders/listModels, one for setState.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ModelPicker", () => {
  it("auto-selects the default model ref when value is empty", async () => {
    const onChange = vi.fn();
    render(<ModelPicker value="" onChange={onChange} />);
    await flush();
    expect(onChange).toHaveBeenCalledWith("OpenRouter/gpt-4o-mini");
  });

  it("does not auto-select when autoPickDefault is false", async () => {
    const onChange = vi.fn();
    render(<ModelPicker value="" onChange={onChange} autoPickDefault={false} />);
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders inherit sentinel option when inheritLabel is provided", async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        value=""
        onChange={onChange}
        inheritLabel="跟随员工默认"
        autoPickDefault={false}
      />,
    );
    await flush();
    fireEvent.click(screen.getByTestId("model-picker"));
    const inherit = screen.getByTestId("model-picker-inherit");
    expect(inherit).toHaveAttribute("role", "option");
    expect(inherit).toHaveTextContent("跟随员工默认");
    // Selecting it emits the sentinel empty value.
    fireEvent.mouseDown(inherit);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("groups models by provider under semantic group headers", async () => {
    const onChange = vi.fn();
    render(<ModelPicker value="" onChange={onChange} />);
    await flush();
    fireEvent.click(screen.getByTestId("model-picker"));
    const groups = screen.getAllByRole("group");
    const labels = groups.map((g) => g.getAttribute("aria-label"));
    expect(labels).toContain("OpenRouter · 默认");
    expect(labels).toContain("Bailian");
  });
});

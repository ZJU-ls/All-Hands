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

// Post-2026-04-25: provider has no default_* fields; the workspace
// default lives on a specific model row's `is_default` flag (singleton
// across the table).
const providers = [
  {
    id: "p1",
    name: "OpenRouter",
    kind: "openai" as const,
    base_url: "https://openrouter.ai",
    api_key_set: true,
    enabled: true,
  },
  {
    id: "p2",
    name: "Bailian",
    kind: "aliyun" as const,
    base_url: "https://dashscope.aliyuncs.com",
    api_key_set: true,
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
    is_default: true,
  },
  {
    id: "m2",
    provider_id: "p2",
    name: "qwen-plus",
    display_name: "Qwen Plus",
    context_window: 128000,
    enabled: true,
    is_default: false,
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

  describe("compact mode (chip-sized fallbacks)", () => {
    it("loading renders a chip-sized button (no full-width text)", async () => {
      // Stall the fetch so we land in the loading branch.
      fetchMock.mockImplementation(() => new Promise(() => {}));
      const onChange = vi.fn();
      render(
        <ModelPicker
          value=""
          onChange={onChange}
          compact
          autoPickDefault={false}
        />,
      );
      const loader = screen.getByTestId("model-picker-loading");
      // Compact mode produces a button shell (chip footprint), NOT the
      // legacy <div>-only loader that was forcing the composer textarea
      // out of frame.
      expect(loader.tagName).toBe("BUTTON");
    });

    it("503 error renders a small inline chip with retry, not an alert card", async () => {
      // First load fails.
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers({ "content-type": "text/plain" }),
          text: () => Promise.resolve("oops"),
        } as unknown as Response),
      );
      const onChange = vi.fn();
      render(
        <ModelPicker
          value=""
          onChange={onChange}
          compact
          compactFallbackLabel="gpt-4o-mini"
          autoPickDefault={false}
        />,
      );
      await flush();
      const errorChip = screen.getByTestId("model-picker-error");
      // Chip shape — single button, fallback label visible.
      expect(errorChip.tagName).toBe("BUTTON");
      expect(errorChip.textContent).toContain("gpt-4o-mini");
      // Inline title carries the technical detail without exploding the
      // composer.
      expect(errorChip.getAttribute("title")).toContain("503");
      // Click triggers retry by re-running the fetch.
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
      fireEvent.click(errorChip);
      await flush();
      // After retry the picker enters happy-path Select shape.
      expect(screen.queryByTestId("model-picker-error")).toBeNull();
      expect(screen.getByTestId("model-picker")).toBeInTheDocument();
    });

    it("non-compact mode preserves the form-friendly alert card", async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          headers: new Headers({ "content-type": "text/plain" }),
          text: () => Promise.resolve("oops"),
        } as unknown as Response),
      );
      const onChange = vi.fn();
      render(
        <ModelPicker value="" onChange={onChange} autoPickDefault={false} />,
      );
      await flush();
      const errorBox = screen.getByTestId("model-picker-error");
      // Form variant retains the alert card · multiple recovery buttons inside.
      expect(errorBox.tagName).toBe("DIV");
      expect(screen.getByTestId("model-picker-retry")).toBeInTheDocument();
      expect(screen.getByTestId("model-picker-manual")).toBeInTheDocument();
    });
  });
});

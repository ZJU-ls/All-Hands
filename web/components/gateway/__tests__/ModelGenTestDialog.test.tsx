import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@/tests/test-utils/i18n-render";
import { ModelGenTestDialog } from "../ModelGenTestDialog";

afterEach(cleanup);

describe("ModelGenTestDialog · capability-aware tabs", () => {
  it("shows ALL declared capability tabs when chat + image both present", () => {
    render(
      <ModelGenTestDialog
        model={{
          id: "m1",
          name: "wan2.5-multi",
          display_name: "wan2.5-multi",
          capabilities: ["chat", "image_gen"],
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("model-test-tab-chat")).not.toBeDisabled();
    expect(screen.getByTestId("model-test-tab-image")).not.toBeDisabled();
    // Tabs that are NOT declared still render but as disabled (placeholder)
    expect(screen.getByTestId("model-test-tab-video")).toBeDisabled();
    expect(screen.getByTestId("model-test-tab-audio")).toBeDisabled();
  });

  it("defaults to chat tab when chat capability is present", () => {
    render(
      <ModelGenTestDialog
        model={{
          id: "m1",
          name: "multi-cap",
          display_name: "Multi",
          capabilities: ["chat", "image_gen"],
        }}
        onClose={() => {}}
      />,
    );
    const chatTab = screen.getByTestId("model-test-tab-chat");
    // Active tab carries data-active="true" (see component)
    expect(chatTab.getAttribute("data-active")).toBe("true");
  });

  it("defaults to first declared gen capability when chat is absent", () => {
    render(
      <ModelGenTestDialog
        model={{
          id: "m1",
          name: "image-only",
          display_name: "Image only",
          capabilities: ["image_gen"],
        }}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByTestId("model-test-tab-image").getAttribute("data-active"),
    ).toBe("true");
    expect(screen.getByTestId("model-test-tab-chat")).toBeDisabled();
  });

  it("renders all four tabs even when only one capability is declared", () => {
    render(
      <ModelGenTestDialog
        model={{
          id: "m1",
          name: "speech-only",
          display_name: "Speech",
          capabilities: ["speech"],
        }}
        onClose={() => {}}
      />,
    );
    // Disabled tabs still render (form/grid is consistent)
    for (const cap of ["chat", "image", "video", "audio"]) {
      expect(screen.getByTestId(`model-test-tab-${cap}`)).toBeInTheDocument();
    }
    expect(
      screen.getByTestId("model-test-tab-audio").getAttribute("data-active"),
    ).toBe("true");
  });
});

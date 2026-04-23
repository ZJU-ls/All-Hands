import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Composer, ThinkingToggle } from "../Composer";

afterEach(cleanup);

function Harness({
  isStreaming,
  onSend,
  onAbort,
  initial = "",
}: {
  isStreaming: boolean;
  onSend: () => void;
  onAbort: () => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSend={onSend}
      onAbort={onAbort}
      isStreaming={isStreaming}
    />
  );
}

describe("Composer", () => {
  it("renders send glyph when idle and calls onSend when clicked", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(
      <Harness
        isStreaming={false}
        onSend={onSend}
        onAbort={onAbort}
        initial="hello"
      />,
    );
    const btn = screen.getByTestId("composer-send");
    expect(btn.getAttribute("aria-label")).toBe("发送");
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledOnce();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("disables send when empty and does not invoke handlers", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(<Harness isStreaming={false} onSend={onSend} onAbort={onAbort} />);
    const btn = screen.getByTestId("composer-send");
    expect(btn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn);
    expect(onSend).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("swaps to stop glyph while streaming and calls onAbort when clicked", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(
      <Harness
        isStreaming
        onSend={onSend}
        onAbort={onAbort}
        initial="queued text"
      />,
    );
    const stop = screen.getByTestId("composer-stop");
    expect(stop.getAttribute("aria-label")).toBe("停止");
    expect(screen.getByTestId("composer-stop-glyph")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-send")).toBeNull();
    fireEvent.click(stop);
    expect(onAbort).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter sends; Shift+Enter inserts newline", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(
      <Harness
        isStreaming={false}
        onSend={onSend}
        onAbort={onAbort}
        initial="hi"
      />,
    );
    const textarea = screen.getByTestId("composer-textarea");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
    onSend.mockClear();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send while IME composition is active", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(
      <Harness
        isStreaming={false}
        onSend={onSend}
        onAbort={onAbort}
        initial="ni"
      />,
    );
    const textarea = screen.getByTestId("composer-textarea");
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("Enter during streaming triggers onAbort (same button semantics)", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(
      <Harness
        isStreaming
        onSend={onSend}
        onAbort={onAbort}
        initial="queued text"
      />,
    );
    fireEvent.keyDown(screen.getByTestId("composer-textarea"), { key: "Enter" });
    expect(onAbort).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("ThinkingToggle", () => {
  it("flips state via the enabled/onChange contract", () => {
    function Wrap() {
      const [on, setOn] = useState(false);
      return <ThinkingToggle enabled={on} onChange={setOn} />;
    }
    render(<Wrap />);
    const btn = screen.getByTestId("composer-thinking-toggle");
    expect(btn.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-checked")).toBe("true");
  });
});

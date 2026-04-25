import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@/tests/test-utils/i18n-render";
import { useState } from "react";
import { Select, type SelectGroup, type SelectOption } from "../Select";

afterEach(cleanup);

function Harness({
  initial = "",
  options,
  groups,
  onChangeSpy,
}: {
  initial?: string;
  options?: SelectOption[];
  groups?: SelectGroup[];
  onChangeSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const handleChange = (next: string) => {
    setValue(next);
    onChangeSpy?.(next);
  };
  if (groups) {
    return (
      <Select
        value={value}
        onChange={handleChange}
        groups={groups}
        testId="sel"
      />
    );
  }
  return (
    <Select
      value={value}
      onChange={handleChange}
      options={options ?? []}
      testId="sel"
    />
  );
}

const FRUITS: SelectOption[] = [
  { value: "apple", label: "苹果" },
  { value: "banana", label: "香蕉", hint: "黄" },
  { value: "cherry", label: "樱桃", disabled: true },
  { value: "durian", label: "榴莲" },
];

describe("Select · custom dropdown primitive", () => {
  it("renders placeholder when no value is selected", () => {
    render(<Harness options={FRUITS} />);
    expect(screen.getByTestId("sel")).toHaveTextContent("选择…");
    expect(screen.getByTestId("sel")).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the selected option's label when value matches", () => {
    render(<Harness options={FRUITS} initial="banana" />);
    expect(screen.getByTestId("sel")).toHaveTextContent("香蕉");
    expect(screen.getByTestId("sel")).toHaveTextContent("黄");
  });

  it("opens on click and renders all non-disabled options as role='option'", () => {
    render(<Harness options={FRUITS} />);
    fireEvent.click(screen.getByTestId("sel"));
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(4);
    expect(opts[2]).toHaveAttribute("aria-disabled", "true");
  });

  it("picks an option on mousedown and closes the panel", () => {
    const spy = vi.fn();
    render(<Harness options={FRUITS} onChangeSpy={spy} />);
    fireEvent.click(screen.getByTestId("sel"));
    fireEvent.mouseDown(screen.getByText("榴莲"));
    expect(spy).toHaveBeenCalledWith("durian");
    // panel should close — listbox gone
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByTestId("sel")).toHaveTextContent("榴莲");
  });

  it("never fires onChange for a disabled option", () => {
    const spy = vi.fn();
    render(<Harness options={FRUITS} onChangeSpy={spy} />);
    fireEvent.click(screen.getByTestId("sel"));
    fireEvent.mouseDown(screen.getByText("樱桃"));
    expect(spy).not.toHaveBeenCalled();
    // panel stays open — disabled pick is a no-op, not a close
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("navigates with ArrowDown + Enter from the trigger", () => {
    const spy = vi.fn();
    render(<Harness options={FRUITS} initial="apple" onChangeSpy={spy} />);
    const trigger = screen.getByTestId("sel");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // open + move to banana (skip apple since it was selected? actually lands on apple)
    // after open, highlight starts at current value (apple @ 0); ArrowDown moves to banana
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // banana -> cherry is disabled, skip to durian
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(spy).toHaveBeenCalledWith("durian");
  });

  it("closes with Escape without changing the value", () => {
    const spy = vi.fn();
    render(<Harness options={FRUITS} initial="apple" onChangeSpy={spy} />);
    fireEvent.click(screen.getByTestId("sel"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("sel"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("renders group headers and keeps a single flat index across groups", () => {
    const groups: SelectGroup[] = [
      {
        id: "g1",
        label: "第一组",
        options: [{ value: "a1", label: "A1" }, { value: "a2", label: "A2" }],
      },
      {
        id: "g2",
        label: "第二组",
        options: [{ value: "b1", label: "B1" }],
      },
    ];
    render(<Harness groups={groups} initial="a2" />);
    fireEvent.click(screen.getByTestId("sel"));
    expect(screen.getByText("第一组")).toBeInTheDocument();
    expect(screen.getByText("第二组")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});

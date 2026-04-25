/**
 * State component contract tests.
 * I-0007 (visual-upgrade DoD): Empty/Error/Loading/FirstRun render + expose the
 * right ARIA role + clicking action wires through.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@/tests/test-utils/i18n-render";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  FirstRun,
} from "@/components/state";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title + description + role=status", () => {
    render(<EmptyState title="尚无供应商" description="先添加一个兼容 OpenAI 协议的端点" />);
    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.getByText("尚无供应商")).toBeDefined();
    expect(screen.getByText(/兼容 OpenAI/)).toBeDefined();
  });

  it("fires action onClick", () => {
    const onClick = vi.fn();
    render(<EmptyState title="无数据" action={{ label: "新建", onClick }} />);
    fireEvent.click(screen.getByText("新建"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorState", () => {
  it("renders role=alert + retry button", () => {
    const onClick = vi.fn();
    render(
      <ErrorState
        title="拉取失败"
        description="连接超时"
        detail="timeout after 10s"
        action={{ label: "重试", onClick }}
      />,
    );
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("拉取失败")).toBeDefined();
    expect(screen.getByText("timeout after 10s")).toBeDefined();
    fireEvent.click(screen.getByText("重试"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("LoadingState", () => {
  it("renders role=status with accessible title (dots)", () => {
    render(<LoadingState title="加载驾驶舱中" description="首次建立 SSE 连接" />);
    const node = screen.getByRole("status");
    expect(node).toBeDefined();
    expect(node.getAttribute("data-variant")).toBe("dots");
    expect(screen.getByText("加载驾驶舱中")).toBeDefined();
  });

  it("renders skeleton variant", () => {
    render(<LoadingState variant="skeleton" />);
    const node = screen.getByRole("status");
    expect(node.getAttribute("data-variant")).toBe("skeleton");
  });
});

describe("FirstRun", () => {
  it("renders steps + primary/secondary CTA", () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <FirstRun
        title="欢迎来到 allhands"
        description="开始前先做这 3 件事"
        steps={[
          { title: "配置供应商", description: "OpenAI / DeepSeek / 本地 Ollama", done: true },
          { title: "创建员工" },
          { title: "开第一个对话" },
        ]}
        primaryAction={{ label: "开始", onClick: onPrimary }}
        secondaryAction={{ label: "稍后", onClick: onSecondary }}
      />,
    );
    expect(screen.getByRole("region", { name: "首次使用引导" })).toBeDefined();
    expect(screen.getByText("配置供应商")).toBeDefined();
    expect(screen.getByText("创建员工")).toBeDefined();
    fireEvent.click(screen.getByText("开始"));
    expect(onPrimary).toHaveBeenCalled();
    fireEvent.click(screen.getByText("稍后"));
    expect(onSecondary).toHaveBeenCalled();
  });
});

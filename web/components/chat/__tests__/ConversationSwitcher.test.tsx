/**
 * ConversationSwitcher · header actions for 新建对话 + 历史会话.
 *
 * Contract:
 *   - "＋ 新建" calls createConversation + routes to the new id.
 *   - "历史 ▾" toggles a popover, lazy-fetches conversations on open, and
 *     routes to the clicked one.
 *   - Disabled when no employee is resolved yet (prevents racing the
 *     initial page load).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ConversationSwitcher } from "../ConversationSwitcher";

const pushSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy }),
}));

vi.mock("@/lib/api", () => ({
  createConversation: vi.fn(),
  listConversations: vi.fn(),
}));

import { createConversation, listConversations } from "@/lib/api";

const mockedCreate = vi.mocked(createConversation);
const mockedList = vi.mocked(listConversations);

beforeEach(() => {
  pushSpy.mockReset();
  mockedCreate.mockReset();
  mockedList.mockReset();
});

afterEach(cleanup);

describe("ConversationSwitcher", () => {
  it("creates a fresh conversation and routes to it", async () => {
    mockedCreate.mockResolvedValue({ id: "new-conv" });
    render(<ConversationSwitcher employeeId="emp1" currentConversationId="c1" />);

    fireEvent.click(screen.getByTestId("chat-new-conversation"));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledWith("emp1"));
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith("/chat/new-conv"));
  });

  it("opens the history popover and lazy-loads conversations", async () => {
    mockedList.mockResolvedValue([
      {
        id: "c1",
        employee_id: "emp1",
        title: "current",
        model_ref_override: null,
        created_at: "2026-04-20T10:00:00Z",
      },
      {
        id: "c2",
        employee_id: "emp1",
        title: "older one",
        model_ref_override: null,
        created_at: "2026-04-19T09:00:00Z",
      },
    ]);

    render(<ConversationSwitcher employeeId="emp1" currentConversationId="c1" />);
    expect(screen.queryByTestId("chat-history-popover")).toBeNull();
    expect(mockedList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("chat-history-trigger"));
    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith({ employeeId: "emp1" }),
    );
    expect(screen.getByTestId("chat-history-popover")).toBeDefined();

    const items = await screen.findAllByTestId("chat-history-item");
    expect(items).toHaveLength(2);
    // The current conversation is marked via aria-current so the user can
    // see "you are here" in the dropdown without another round-trip.
    const current = items.find((i) => i.getAttribute("aria-current") === "true");
    expect(current?.textContent).toContain("current");
  });

  it("routes to a clicked conversation and does not re-navigate if current", async () => {
    mockedList.mockResolvedValue([
      {
        id: "c1",
        employee_id: "emp1",
        title: "current",
        model_ref_override: null,
        created_at: "2026-04-20T10:00:00Z",
      },
      {
        id: "c2",
        employee_id: "emp1",
        title: "older",
        model_ref_override: null,
        created_at: "2026-04-19T09:00:00Z",
      },
    ]);

    render(<ConversationSwitcher employeeId="emp1" currentConversationId="c1" />);
    fireEvent.click(screen.getByTestId("chat-history-trigger"));
    const items = await screen.findAllByTestId("chat-history-item");
    const older = items.find((i) => i.textContent?.includes("older"));
    fireEvent.click(older!);
    expect(pushSpy).toHaveBeenCalledWith("/chat/c2");

    // Re-open, click current → popover closes without a redundant push.
    pushSpy.mockReset();
    fireEvent.click(screen.getByTestId("chat-history-trigger"));
    const items2 = await screen.findAllByTestId("chat-history-item");
    const current = items2.find((i) => i.getAttribute("aria-current") === "true");
    fireEvent.click(current!);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("disables both buttons when employeeId is null", () => {
    render(<ConversationSwitcher employeeId={null} currentConversationId="c1" />);
    expect(
      (screen.getByTestId("chat-new-conversation") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("chat-history-trigger") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/**
 * ConfirmationDialog · Phase 4e interrupt-resume handoff (ADR 0014).
 *
 * Two behaviours to pin:
 *   1. Legacy polling-source confirmations (allhands.confirm_required): the
 *      dialog only calls /resolve; it must NOT publish a resume request,
 *      because the original chat SSE is still open on the backend.
 *   2. New interrupt-source confirmations (allhands.interrupt_required): the
 *      dialog calls /resolve AND publishes a requestResume so InputBar can
 *      open the /resume SSE that continues the paused turn.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@/tests/test-utils/i18n-render";

import { useChatStore } from "@/lib/store";
import { ConfirmationDialog } from "@/components/chat/ConfirmationDialog";

let fetchSpy: MockInstance<
  (input: string | URL | Request, init?: RequestInit) => Promise<Response>
>;

beforeEach(() => {
  // Zustand store reset — the dialog reads from it, so each test gets a fresh one.
  useChatStore.setState({
    messages: [],
    streamingMessage: null,
    pendingConfirmations: [],
    pendingResumeRequest: null,
    isStreaming: false,
    streamError: null,
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConfirmationDialog · Phase 4e resume handoff", () => {
  it("polling-source confirmation: resolve only, no resume request published", async () => {
    useChatStore.getState().addConfirmation({
      confirmationId: "conf_polling_1",
      toolCallId: "tc1",
      summary: "Delete employee-42",
      rationale: "scope=WRITE",
      diff: { id: "42" },
      conversationId: "conv-X",
      source: "polling",
    });

    render(<ConfirmationDialog />);
    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/confirmations/conf_polling_1/resolve"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // Must NOT set a resume request — legacy flow relies on the original
    // chat SSE's polling gate to pick up the DB change.
    expect(useChatStore.getState().pendingResumeRequest).toBeNull();
    // Confirmation removed from the queue.
    expect(useChatStore.getState().pendingConfirmations).toHaveLength(0);
  });

  it("interrupt-source confirmation: resolve + requestResume with decision", async () => {
    useChatStore.getState().addConfirmation({
      confirmationId: "itr_abc123",
      toolCallId: "tc1",
      summary: "Delete employee-42",
      rationale: "scope=WRITE",
      diff: { id: "42" },
      conversationId: "conv-X",
      source: "interrupt",
    });

    render(<ConfirmationDialog />);
    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/confirmations/itr_abc123/resolve"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // Resume request published so InputBar's useEffect can pick up and
    // open /conversations/conv-X/resume.
    await waitFor(() => {
      const req = useChatStore.getState().pendingResumeRequest;
      expect(req).toEqual({ conversationId: "conv-X", decision: "approve" });
    });
  });

  it("interrupt-source reject decision flows through to requestResume", async () => {
    useChatStore.getState().addConfirmation({
      confirmationId: "itr_xyz",
      toolCallId: "tc1",
      summary: "delete",
      rationale: "",
      conversationId: "conv-Y",
      source: "interrupt",
    });

    render(<ConfirmationDialog />);
    fireEvent.click(screen.getByText("Reject"));

    await waitFor(() => {
      expect(useChatStore.getState().pendingResumeRequest).toEqual({
        conversationId: "conv-Y",
        decision: "reject",
      });
    });
  });
});

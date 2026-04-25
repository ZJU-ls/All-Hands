"use client";

import { useCallback, useState } from "react";
import { useChatStore } from "@/lib/store";
import { answerUserInput } from "@/lib/api";
import { Icon } from "@/components/ui/icon";
import { useDismissOnEscape } from "@/lib/use-dismiss-on-escape";

/**
 * ADR 0019 C3 · Clarification dialog for ``ask_user_question``.
 *
 * The agent loop suspends mid-turn awaiting answers; this dialog renders
 * the questions, captures one free-text answer per question, and POSTs
 * to ``/api/user-input/{id}/answer``. The polling UserInputDeferred on
 * the backend unblocks on its next tick and the SSE stream resumes
 * delivering the rest of the assistant turn.
 */
export function UserInputDialog() {
  const { pendingUserInputs, removeUserInput } = useChatStore();
  const current = pendingUserInputs[0];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      await answerUserInput(current.userInputId, answers);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[UserInputDialog] submit failed:", err);
    } finally {
      removeUserInput(current.userInputId);
      setAnswers({});
      setLoading(false);
    }
  }, [current, answers, removeUserInput]);

  // ESC = treat as cancel by submitting empty answers (the suspended
  // tool will see ``answers={}`` and the LLM can decide how to proceed).
  // Cleaner than dropping the row to EXPIRED — that path forces a 600s
  // wait before the agent sees anything.
  const handleEscape = useCallback(() => {
    if (loading) return;
    void submit();
  }, [loading, submit]);
  useDismissOnEscape(Boolean(current), handleEscape);

  if (!current) return null;

  const allAnswered = current.questions.every(
    (q) => (answers[q.label] ?? "").trim().length > 0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface border border-border shadow-soft-lg p-6">
        <div className="mb-3 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Icon name="message-square" size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-text">
              Quick clarification
            </h2>
            <p className="mt-0.5 text-[12px] text-text-muted">
              Answer these so the agent can continue.
            </p>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          {current.questions.map((q) => (
            <div key={q.label} className="space-y-1">
              <label
                htmlFor={`uiq-${q.label}`}
                className="block text-[12px] font-medium text-text"
              >
                {q.description || q.label}
              </label>
              {q.preview && (
                <p className="text-[11px] text-text-muted">{q.preview}</p>
              )}
              <input
                id={`uiq-${q.label}`}
                value={answers[q.label] ?? ""}
                disabled={loading}
                onChange={(e) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [q.label]: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text placeholder:text-text-muted focus:outline-none focus:border-primary disabled:opacity-50"
                placeholder="Your answer"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => void submit()}
            disabled={loading || !allAnswered}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-50 transition-colors duration-fast"
          >
            {loading ? (
              <Icon name="loader" size={14} className="animate-spin" />
            ) : (
              <Icon name="send" size={14} strokeWidth={2.25} />
            )}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

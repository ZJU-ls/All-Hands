import type { TaskStatus } from "@/lib/tasks-api";
import { statusLabel, statusTone } from "@/lib/tasks-api";

const DOT_TONE: Record<ReturnType<typeof statusTone>, string> = {
  neutral: "bg-border-strong",
  info: "bg-primary",
  warn: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
};

const LABEL_TONE: Record<ReturnType<typeof statusTone>, string> = {
  neutral: "text-text-muted",
  info: "text-primary",
  warn: "text-warning",
  success: "text-success",
  danger: "text-danger",
};

export function TaskStatusPill({
  status,
  compact = false,
}: {
  status: TaskStatus;
  compact?: boolean;
}) {
  const tone = statusTone(status);
  const isRunning = status === "running";
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${compact ? "text-[11px]" : "text-xs"}`}
      aria-label={`status: ${status}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_TONE[tone]}`}
        style={
          isRunning ? { animation: "ah-pulse 1.4s var(--ease-out) infinite" } : undefined
        }
      />
      <span className={LABEL_TONE[tone]}>{statusLabel(status)}</span>
    </span>
  );
}

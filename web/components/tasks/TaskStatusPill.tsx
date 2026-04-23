import { Icon, type IconName } from "@/components/ui/icon";
import type { TaskStatus } from "@/lib/tasks-api";
import { statusLabel, statusTone } from "@/lib/tasks-api";

type Tone = ReturnType<typeof statusTone>;

/**
 * V2 (ADR 0016) soft-pill status pill with a matching glyph per status. Tone
 * mapping delegates to `statusTone`, so new statuses only need a row here to
 * pick up a new icon / pill colour.
 */

const PILL_TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-muted",
  info: "bg-primary-muted text-primary",
  warn: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
};

const STATUS_ICON: Record<TaskStatus, IconName> = {
  queued: "clock",
  running: "loader",
  needs_input: "message-square",
  needs_approval: "shield-check",
  completed: "check-circle-2",
  failed: "alert-circle",
  cancelled: "x",
};

export function TaskStatusPill({
  status,
  compact = false,
}: {
  status: TaskStatus;
  compact?: boolean;
}) {
  const tone = statusTone(status);
  const icon = STATUS_ICON[status];
  const isRunning = status === "running";
  const size = compact ? 10 : 11;

  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium " +
        (compact ? "text-[10px]" : "text-[11px]") +
        " " +
        PILL_TONE[tone]
      }
      aria-label={`status: ${status}`}
    >
      <Icon
        name={icon}
        size={size}
        className={isRunning ? "animate-spin" : undefined}
      />
      <span>{statusLabel(status)}</span>
    </span>
  );
}

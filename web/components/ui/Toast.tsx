"use client";

/**
 * Toast · global lightweight notification system.
 *
 * Reference inspiration:
 *   - Linear: bottom-right stack, 4s auto-dismiss, single click to dismiss
 *   - Vercel: top-center for success, persistent for error
 *   - Sonner / react-hot-toast: minimal API surface (`toast()` / `toast.error()`)
 *
 * Design choices for allhands:
 *   - Bottom-center stack (matches our existing chip placement: stream
 *     status chip / bulk action bar both live there).
 *   - Default 3s auto-dismiss · errors stay 6s (longer to read).
 *   - Single-click anywhere on the toast dismisses it.
 *   - Stacks newest-on-top, max 4 visible · older drop off the bottom.
 *   - Strictly token colors per §3.8 visual contract.
 *
 * API:
 *   const { push, success, error, info } = useToast();
 *   push({ kind: "success", message: "Pinned 3 artifacts" });
 *   success("Copied to clipboard");
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export type ToastKind = "success" | "error" | "info" | "warning";

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional sub-line for error detail / hint. */
  detail?: string;
  /** Override default lifetime in ms. 0 → never auto-dismiss. */
  durationMs?: number;
};

type Ctx = {
  push: (t: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
  success: (msg: string, detail?: string) => number;
  error: (msg: string, detail?: string) => number;
  info: (msg: string, detail?: string) => number;
  warning: (msg: string, detail?: string) => number;
};

const ToastContext = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Provider is mounted in AppShell; outside it (storybook / orphan
    // renders) fall back to a no-op so call sites don't crash.
    return {
      push: () => 0,
      dismiss: () => {},
      success: () => 0,
      error: () => 0,
      info: () => 0,
      warning: () => 0,
    };
  }
  return ctx;
}

const KIND_TONE: Record<ToastKind, string> = {
  success: "border-success/30 bg-success-soft text-success",
  error: "border-danger/30 bg-danger-soft text-danger",
  warning: "border-warning/30 bg-warning-soft text-warning",
  info: "border-primary/30 bg-primary-muted text-primary",
};

const KIND_ICON: Record<ToastKind, IconName> = {
  success: "check-circle-2",
  error: "alert-circle",
  warning: "alert-triangle",
  info: "info",
};

const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  success: 2400,
  info: 3000,
  warning: 4000,
  error: 6000,
};

const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">): number => {
      const id = ++idRef.current;
      const duration = t.durationMs ?? DEFAULT_DURATION_MS[t.kind];
      setToasts((prev) => {
        // Newest on top of the stack; cap visible count.
        const next = [{ ...t, id }, ...prev];
        if (next.length > MAX_VISIBLE) {
          for (const drop of next.slice(MAX_VISIBLE)) {
            const tm = timersRef.current.get(drop.id);
            if (tm) clearTimeout(tm);
            timersRef.current.delete(drop.id);
          }
          return next.slice(0, MAX_VISIBLE);
        }
        return next;
      });
      if (duration > 0) {
        const handle = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
  );

  const success = useCallback(
    (message: string, detail?: string) => push({ kind: "success", message, detail }),
    [push],
  );
  const error = useCallback(
    (message: string, detail?: string) => push({ kind: "error", message, detail }),
    [push],
  );
  const info = useCallback(
    (message: string, detail?: string) => push({ kind: "info", message, detail }),
    [push],
  );
  const warning = useCallback(
    (message: string, detail?: string) => push({ kind: "warning", message, detail }),
    [push],
  );

  // Tear down all pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, []);

  // Clear any in-flight toasts on route change — they were anchored to the
  // previous page's action and the new page shouldn't inherit them. Errors
  // are kept (longer duration) so the user still sees a server-side
  // failure they may want to retry.
  const pathname = usePathname();
  useEffect(() => {
    setToasts((prev) => {
      const kept = prev.filter((t) => t.kind === "error");
      for (const t of prev) {
        if (t.kind !== "error") {
          const tm = timersRef.current.get(t.id);
          if (tm) clearTimeout(tm);
          timersRef.current.delete(t.id);
        }
      }
      return kept;
    });
  }, [pathname]);

  return (
    <ToastContext.Provider value={{ push, dismiss, success, error, info, warning }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="notifications"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-full max-w-[420px] -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onDismiss(t.id)}
          className={cn(
            "pointer-events-auto inline-flex w-full items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-2.5 text-left shadow-soft-lg backdrop-blur-md animate-fade-up",
            KIND_TONE[t.kind],
          )}
          aria-label={`dismiss ${t.message}`}
        >
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <Icon name={KIND_ICON[t.kind]} size={14} />
          </span>
          <span className="min-w-0 flex-1 text-text">
            <span className="block text-[13px] font-medium">{t.message}</span>
            {t.detail ? (
              <span className="mt-0.5 block break-words text-caption text-text-muted">
                {t.detail}
              </span>
            ) : null}
          </span>
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-text-subtle"
          >
            <Icon name="x" size={11} />
          </span>
        </button>
      ))}
    </div>
  );
}

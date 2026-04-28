"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * URL-state hook for the right-side trace drawer.
 *
 * Pre-2026-04-27 the trace chip was a `<Link>` that hard-navigated to
 * `/observatory/runs/<id>`, which unmounted the chat page and killed the
 * live SSE stream. Trace viewing was effectively a "lose your turn" button.
 *
 * Now the chip writes `?trace=<run_id>` via `router.replace` (no
 * navigation) and AppShell mounts a global drawer that reads this query.
 * Closing the drawer just deletes the query — the underlying page never
 * unmounts, so spawn_subagent / streaming Lead replies stay alive.
 *
 * The hook is intentionally tiny — three callbacks + the current id — so
 * it can be cheaply consumed from both the chip (open) and the drawer
 * (close on ESC / overlay).
 */
export const TRACE_QUERY_KEY = "trace";

export function useTraceDrawer(): {
  runId: string | null;
  isOpen: boolean;
  open: (runId: string) => void;
  close: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const runId = params?.get(TRACE_QUERY_KEY) ?? null;

  const replaceWith = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      const target = qs ? `${pathname}?${qs}` : pathname;
      router.replace(target, { scroll: false });
    },
    [pathname, router],
  );

  const open = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      next.set(TRACE_QUERY_KEY, id);
      replaceWith(next);
    },
    [params, replaceWith],
  );

  const close = useCallback(() => {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.delete(TRACE_QUERY_KEY);
    replaceWith(next);
  }, [params, replaceWith]);

  return useMemo(
    () => ({ runId, isOpen: runId !== null, open, close }),
    [runId, open, close],
  );
}

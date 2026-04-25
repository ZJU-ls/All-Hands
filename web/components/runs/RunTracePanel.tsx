"use client";

/**
 * RunTracePanel · container for run header + optional inline error +
 * turn list. Stays lean — visual weight lives in the children.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  fetchRunDetail,
  RunNotFoundError,
  type RunDetailDto,
} from "@/lib/observatory-api";
import { LoadingState, ErrorState, EmptyState } from "@/components/state";
import { RunHeader } from "./RunHeader";
import { RunTurnList } from "./RunTurnList";
import { RunArtifacts } from "./RunArtifacts";
import { RunError } from "./RunError";

type Props =
  | { runId: string; run?: never }
  | { run: RunDetailDto; runId?: never };

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; notFound: boolean }
  | { status: "ready"; run: RunDetailDto };

export function RunTracePanel(props: Props) {
  const t = useTranslations("runs.tracePanel");
  const initialRun = "run" in props ? props.run : undefined;
  const runId = "runId" in props ? props.runId : undefined;

  const [state, setState] = useState<State>(() =>
    initialRun ? { status: "ready", run: initialRun } : { status: "idle" },
  );

  const fallbackMsg = t("loadFailed");
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchRunDetail(runId)
      .then((run) => {
        if (cancelled) return;
        setState({ status: "ready", run });
      })
      .catch((err) => {
        if (cancelled) return;
        const notFound = err instanceof RunNotFoundError;
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : fallbackMsg,
          notFound,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [runId, fallbackMsg]);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div data-testid="run-trace-panel" data-state="loading">
        <LoadingState title={t("loading")} variant="skeleton" />
      </div>
    );
  }

  if (state.status === "error") {
    // Not-found is not an *error* — the run just isn't around anymore (TTL,
    // cleanup, or never persisted). Use a neutral EmptyState so the drawer
    // doesn't scream red at the user. Reserve ErrorState for real failures
    // (network drop, parse error) where retry makes sense.
    if (state.notFound) {
      return (
        <div data-testid="run-trace-panel" data-state="error">
          <EmptyState
            icon="clock"
            title={t("notFoundTitle")}
            description={t("notFoundDescription")}
          />
        </div>
      );
    }
    return (
      <div data-testid="run-trace-panel" data-state="error">
        <ErrorState
          title={t("errorTitle")}
          description={t("errorDescription")}
          detail={state.message}
        />
      </div>
    );
  }

  const { run } = state;
  return (
    <section
      data-testid="run-trace-panel"
      data-state="ready"
      className="flex flex-col gap-3"
    >
      <RunHeader run={run} />
      {run.error && <RunError error={run.error} />}
      <RunTurnList turns={run.turns} />
      <RunArtifacts artifacts={run.artifacts} />
    </section>
  );
}

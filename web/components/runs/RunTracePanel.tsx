"use client";

import { useEffect, useState } from "react";
import {
  fetchRunDetail,
  RunNotFoundError,
  type RunDetailDto,
} from "@/lib/observatory-api";
import { LoadingState, ErrorState } from "@/components/state";
import { RunHeader } from "./RunHeader";
import { RunTurnList } from "./RunTurnList";
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
  const initialRun = "run" in props ? props.run : undefined;
  const runId = "runId" in props ? props.runId : undefined;

  const [state, setState] = useState<State>(() =>
    initialRun ? { status: "ready", run: initialRun } : { status: "idle" },
  );

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
            err instanceof Error ? err.message : "加载 trace 出错,请稍后重试",
          notFound,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div data-testid="run-trace-panel" data-state="loading">
        <LoadingState title="加载 trace" variant="skeleton" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div data-testid="run-trace-panel" data-state="error">
        <ErrorState
          title={state.notFound ? "trace 取不到" : "trace 加载失败"}
          description={state.notFound ? "这条 run 已经过期或不存在" : undefined}
          detail={state.notFound ? undefined : state.message}
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
    </section>
  );
}

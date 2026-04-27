"""ObservatoryService — summary + trace listing.

Self-instrumented · sources are the local ``events`` table (run.* / llm.call /
tool.invoked / tool.returned) and the ``messages`` projection. Langfuse and
the embedded bootstrap flow were removed in 2026-04-25 — every metric the
UI shows comes from data the platform produces itself.

This is the L01 shared implementation — both `api/routers/observatory.py`
and the 4 Meta Tools in `execution/tools/meta/observatory_tools.py` delegate
here so REST and Lead Agent can never drift.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from allhands.core import (
    ArtifactSummary,
    Message,
    ObservabilityConfig,
    ObservatoryConversationBreakdown,
    ObservatoryEmployeeBreakdown,
    ObservatoryErrorBreakdown,
    ObservatoryModelBreakdown,
    ObservatorySummary,
    ObservatoryToolBreakdown,
    RunDetail,
    RunError,
    RunStatus,
    RunTokenUsage,
    TimeSeries,
    TimeSeriesPoint,
    TraceSummary,
    Turn,
    TurnLLMCall,
    TurnMessage,
    TurnThinking,
    TurnToolCall,
    TurnUserInput,
)
from allhands.services.model_pricing import (
    ModelPrice,
    estimate_cost_usd,
    overlay_from_entries,
)

if TYPE_CHECKING:
    from allhands.core import EventEnvelope
    from allhands.persistence.repositories import (
        ArtifactRepo,
        ConversationRepo,
        EmployeeRepo,
        EventRepo,
        ModelPriceRepo,
        ObservabilityConfigRepo,
        TaskRepo,
    )


_RUN_KINDS = ("run.",)
_RUN_FAILED_KINDS = ("run.failed",)


class ObservatoryService:
    """Shared service behind REST + 4 Meta Tools (L01 Tool First parity).

    All state comes from three repos; no Langfuse HTTP calls yet — the
    trace views derive from the local `events` table so the page has real
    numbers on day 1 even before Langfuse is reachable.
    """

    def __init__(
        self,
        *,
        event_repo: EventRepo,
        employee_repo: EmployeeRepo,
        config_repo: ObservabilityConfigRepo,
        conversation_repo: ConversationRepo | None = None,
        task_repo: TaskRepo | None = None,
        artifact_repo: ArtifactRepo | None = None,
        price_repo: ModelPriceRepo | None = None,
        workspace_id: str = "default",
    ) -> None:
        self._events = event_repo
        self._employees = employee_repo
        self._config = config_repo
        # Optional · DB price overlay. None → cost lookup uses code seed only.
        self._prices = price_repo
        # Optional for back-compat with callers that only need summary/list
        # (the 4 Meta Tools). The `/runs/{id}` route passes both; get_run_detail
        # will raise a clear error if either is missing.
        self._conversations = conversation_repo
        self._tasks = task_repo
        # Optional artifact repo · enables the "产出制品" panel on RunDetail.
        # When None the field stays empty; the drawer just hides the section.
        self._artifacts = artifact_repo
        self._ws = workspace_id

    async def _load_price_overlay(self) -> dict[str, ModelPrice]:
        """Load DB price overlay snapshot. ``{}`` when no repo wired (tests)."""
        if self._prices is None:
            return {}
        try:
            entries = await self._prices.list_all()
        except Exception:
            # Never let an overlay-load error break observability — fall back
            # to code seed silently. Caller logs the underlying issue if any.
            return {}
        return overlay_from_entries(entries)

    async def get_status(self) -> ObservabilityConfig:
        return await self._config.load()

    async def get_summary(
        self,
        *,
        now: datetime | None = None,
        window_hours: int = 24,
        employee_id: str | None = None,
        model_ref: str | None = None,
    ) -> ObservatorySummary:
        """Aggregate the last ``window_hours`` of run.* events into a summary.

        Optional ``employee_id`` / ``model_ref`` filters narrow the scope —
        the per-employee detail page passes ``employee_id="emp-writer"``
        and gets back the same shape but scoped to writer's runs only.
        Filtering happens in-memory after the SQL pull (run.* volume is
        small enough that the extra round-trip would cost more than the
        scan).
        """
        ts_now = now or datetime.now(UTC)
        day_start = ts_now - timedelta(hours=window_hours)

        cfg = await self._config.load()
        price_overlay = await self._load_price_overlay()

        runs_total = await self._events.count_since(
            since=datetime.fromtimestamp(0, tz=UTC),
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
        )

        recent_all = await self._events.list_recent(
            limit=2000,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
            since=day_start,
        )

        def _matches_filters(ev: object) -> bool:
            payload = getattr(ev, "payload", {})
            if employee_id is not None:
                actor = getattr(ev, "actor", None)
                eid = payload.get("employee_id") if isinstance(payload, dict) else None
                if eid != employee_id and actor != employee_id:
                    return False
            if model_ref is not None:
                mr = payload.get("model_ref") if isinstance(payload, dict) else None
                if mr != model_ref:
                    return False
            return True

        recent = [e for e in recent_all if _matches_filters(e)]
        # Treat anything under the run.* prefix as a "run" for window counts —
        # legacy seed data uses "run.finished"; production uses
        # "run.completed". `count_since` was previously the source of truth
        # but doesn't accept dimension filters, so we sum in-memory now.
        runs_24h = sum(1 for e in recent if e.kind.startswith("run."))
        failed_24h = sum(1 for e in recent if e.kind == "run.failed")
        failure_rate = (failed_24h / runs_24h) if runs_24h else 0.0
        durations = [
            float(e.payload["duration_s"])
            for e in recent
            if isinstance(e.payload.get("duration_s"), (int, float))
        ]
        p50 = _percentile(durations, 0.5) if durations else 0.0
        p95 = _percentile(durations, 0.95) if durations else 0.0
        p99 = _percentile(durations, 0.99) if durations else 0.0

        # Token aggregation. We accept three payload shapes for back-compat:
        #   - new: payload.tokens = {"input":N,"output":N,"total":N}
        #   - mid: payload.tokens = N (legacy single-int)
        #   - old: missing entirely → contributes nothing
        # ``call_total`` is the sum of every run's ``total`` count;
        # ``avg_tokens_per_run`` is over runs that actually reported tokens
        # (so a single tokenless run doesn't drag the average to zero).
        input_total = 0
        output_total = 0
        total_total = 0
        runs_with_tokens = 0
        run_total_tokens: list[int] = []
        for e in recent:
            tok = e.payload.get("tokens")
            if isinstance(tok, dict):
                ti = int(tok.get("input", 0) or 0)
                to = int(tok.get("output", 0) or 0)
                tt = int(tok.get("total", 0) or 0) or (ti + to)
            elif isinstance(tok, int):
                ti = to = 0
                tt = int(tok)
            else:
                continue
            input_total += ti
            output_total += to
            total_total += tt
            if tt > 0:
                runs_with_tokens += 1
                run_total_tokens.append(tt)
        avg_tokens = int(sum(run_total_tokens) / runs_with_tokens) if runs_with_tokens else 0

        # LLM calls: payload.llm_calls (per-run count from finalize_run).
        llm_calls_total = sum(
            int(e.payload.get("llm_calls", 0) or 0)
            for e in recent
            if isinstance(e.payload.get("llm_calls"), int)
        )

        employees = await self._employees.list_all()
        name_by_id = {e.id: e.name for e in employees}
        emp_stats: dict[str, dict[str, float]] = {}
        model_stats: dict[str, dict[str, float]] = {}
        cost_total = 0.0
        for e in recent:
            tok = e.payload.get("tokens")
            ti = to = tt = 0
            if isinstance(tok, dict):
                ti = int(tok.get("input", 0) or 0)
                to = int(tok.get("output", 0) or 0)
                tt = int(tok.get("total", 0) or 0) or (ti + to)
            elif isinstance(tok, int):
                tt = int(tok)
            model_ref = e.payload.get("model_ref")
            mr = model_ref if isinstance(model_ref, str) and model_ref else None
            run_cost = estimate_cost_usd(mr, ti, to, overlay=price_overlay)
            cost_total += run_cost

            emp_id = e.payload.get("employee_id") or e.actor
            if isinstance(emp_id, str):
                slot = emp_stats.setdefault(
                    emp_id,
                    {"runs": 0.0, "input": 0.0, "output": 0.0, "total": 0.0, "cost": 0.0},
                )
                slot["runs"] += 1
                slot["input"] += ti
                slot["output"] += to
                slot["total"] += tt
                slot["cost"] += run_cost
            if mr:
                m = model_stats.setdefault(
                    mr,
                    {"runs": 0.0, "input": 0.0, "output": 0.0, "total": 0.0, "cost": 0.0},
                )
                m["runs"] += 1
                m["input"] += ti
                m["output"] += to
                m["total"] += tt
                m["cost"] += run_cost

        by_employee = [
            ObservatoryEmployeeBreakdown(
                employee_id=eid,
                employee_name=name_by_id.get(eid, eid),
                runs_count=int(stats["runs"]),
                input_tokens=int(stats["input"]),
                output_tokens=int(stats["output"]),
                total_tokens=int(stats["total"]),
                estimated_cost_usd=round(stats["cost"], 6),
            )
            for eid, stats in sorted(emp_stats.items(), key=lambda kv: -kv[1]["runs"])
        ]
        by_model = [
            ObservatoryModelBreakdown(
                model_ref=ref,
                runs_count=int(stats["runs"]),
                input_tokens=int(stats["input"]),
                output_tokens=int(stats["output"]),
                total_tokens=int(stats["total"]),
                estimated_cost_usd=round(stats["cost"], 6),
            )
            for ref, stats in sorted(model_stats.items(), key=lambda kv: -kv[1]["runs"])
        ]
        # cfg.observability_enabled is always True now (self-instrumented),
        # but we still load() the row to surface the flush of any flag mutation.
        _ = cfg

        # by_tool aggregation · sourced from tool.invoked + tool.returned
        # events. tool.invoked counts invocations; tool.returned with
        # status="failed" / non-empty error counts failures. Avg duration
        # is derived from the gap between matching invoked / returned by
        # tool_call_id within the same window.
        tool_events = await self._events.list_recent(
            limit=5000,
            workspace_id=self._ws,
            kind_prefixes=["tool."],
            since=day_start,
        )
        tool_events = [e for e in tool_events if _matches_filters(e)]
        tool_invocations: dict[str, int] = {}
        tool_failures: dict[str, int] = {}
        tool_invoked_at: dict[str, tuple[str, datetime]] = {}  # tool_call_id → (tool_id, ts)
        tool_durations: dict[str, list[float]] = {}
        for e in tool_events:
            payload = e.payload
            tid = payload.get("tool_id")
            if not isinstance(tid, str) or not tid:
                continue
            tcid = payload.get("tool_call_id")
            if e.kind == "tool.invoked":
                tool_invocations[tid] = tool_invocations.get(tid, 0) + 1
                if isinstance(tcid, str):
                    tool_invoked_at[tcid] = (tid, e.published_at)
            elif e.kind == "tool.returned":
                status_v = payload.get("status")
                err = payload.get("error")
                failed = (status_v == "failed") or (err is not None and err != "")
                if failed:
                    tool_failures[tid] = tool_failures.get(tid, 0) + 1
                if isinstance(tcid, str) and tcid in tool_invoked_at:
                    started_tid, started_at = tool_invoked_at.pop(tcid)
                    if started_tid == tid:
                        delta = (e.published_at - started_at).total_seconds()
                        if 0 <= delta < 600:
                            tool_durations.setdefault(tid, []).append(delta)
        by_tool = []
        for tid, inv in sorted(tool_invocations.items(), key=lambda kv: -kv[1]):
            fails = tool_failures.get(tid, 0)
            durs = tool_durations.get(tid, [])
            avg_dur = round(sum(durs) / len(durs), 3) if durs else 0.0
            by_tool.append(
                ObservatoryToolBreakdown(
                    tool_id=tid,
                    invocations=inv,
                    failures=fails,
                    failure_rate=round(fails / inv, 4) if inv else 0.0,
                    avg_duration_s=avg_dur,
                )
            )

        # top_errors aggregation · group failed runs by ``error_kind``.
        err_counts: dict[str, int] = {}
        err_last_msg: dict[str, str] = {}
        err_last_seen: dict[str, datetime] = {}
        for e in recent:
            if e.kind != "run.failed":
                continue
            kind = e.payload.get("error_kind") or "unknown"
            kind_str = str(kind)
            err_counts[kind_str] = err_counts.get(kind_str, 0) + 1
            msg = e.payload.get("error")
            if isinstance(msg, str) and msg:
                err_last_msg[kind_str] = msg
            prev = err_last_seen.get(kind_str)
            if prev is None or e.published_at > prev:
                err_last_seen[kind_str] = e.published_at
        top_errors = [
            ObservatoryErrorBreakdown(
                error_kind=k,
                count=err_counts[k],
                last_message=err_last_msg.get(k, "")[:200],
                last_seen_at=err_last_seen.get(k),
            )
            for k in sorted(err_counts, key=lambda k: -err_counts[k])
        ]

        # ── Latency histogram for the heatmap card ───────────────────────
        # Always covers the last 24 hours regardless of the summary window
        # — a 7-day heatmap would compress everything into illegible cells.
        heatmap_start = ts_now - timedelta(hours=24)
        # Inspired by Honeycomb's heatmap-of-duration view. We bucket by
        # (hour-of-window, log-bucket-of-latency) so the front-end can
        # render a 24x8 grid showing where the long tails live.
        # The lookup is local-only — no extra DB roundtrip.
        latency_hist_buckets: list[float] = [
            0.5,
            1.0,
            2.0,
            5.0,
            10.0,
            30.0,
            60.0,
        ]  # seconds; cells: <0.5, <1, <2, <5, <10, <30, <60, >=60
        # cells[hour_index][bucket_index]
        n_hours = 24
        n_lat = len(latency_hist_buckets) + 1
        cells: list[list[int]] = [[0] * n_lat for _ in range(n_hours)]
        for e in recent:
            if e.kind not in ("run.completed", "run.failed"):
                continue
            dur = e.payload.get("duration_s")
            if not isinstance(dur, (int, float)):
                continue
            if e.published_at < heatmap_start:
                continue
            # hour index 0..23 from oldest to newest
            seconds_into = (e.published_at - heatmap_start).total_seconds()
            h = int(seconds_into // 3600)
            if h < 0 or h >= n_hours:
                continue
            # bucket index
            b = n_lat - 1
            for i, edge in enumerate(latency_hist_buckets):
                if dur < edge:
                    b = i
                    break
            cells[h][b] += 1
        latency_heatmap = cells
        latency_heatmap_buckets_s = list(latency_hist_buckets)

        # Previous-period comparison: same 24h window starting 48h ago →
        # ending 24h ago. Lets the UI render a real "vs yesterday" delta.
        prev_start = ts_now - timedelta(hours=48)
        prev_end = day_start
        prev_recent = await self._events.list_recent(
            limit=2000,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
            since=prev_start,
        )
        prev_recent = [e for e in prev_recent if e.published_at < prev_end and _matches_filters(e)]
        prev_runs = sum(1 for e in prev_recent if e.kind in ("run.completed", "run.failed"))
        prev_failed = sum(1 for e in prev_recent if e.kind == "run.failed")
        prev_failure_rate = (prev_failed / prev_runs) if prev_runs else 0.0
        prev_durations = [
            float(e.payload["duration_s"])
            for e in prev_recent
            if isinstance(e.payload.get("duration_s"), (int, float))
        ]
        prev_p50 = _percentile(prev_durations, 0.5) if prev_durations else 0.0
        prev_cost = 0.0
        for e in prev_recent:
            tok = e.payload.get("tokens")
            ti = to = 0
            if isinstance(tok, dict):
                ti = int(tok.get("input", 0) or 0)
                to = int(tok.get("output", 0) or 0)
            mr = e.payload.get("model_ref")
            prev_cost += estimate_cost_usd(
                mr if isinstance(mr, str) else None, ti, to, overlay=price_overlay
            )

        def _pct(curr: float, prev: float) -> float | None:
            if prev <= 0:
                return None
            return round((curr - prev) / prev, 4)

        runs_delta = _pct(float(runs_24h), float(prev_runs))
        failure_delta = _pct(failure_rate, prev_failure_rate)
        p50_delta = _pct(p50, prev_p50)
        cost_delta = _pct(cost_total, prev_cost)

        # by_conversation aggregation · group runs by payload.conversation_id
        # so the UI can show "Sessions · top conversations" (Langfuse style).
        # Separate parallel dicts (numbers vs employee_id vs last_seen_at)
        # keep mypy happy without per-line type ignores.
        conv_runs: dict[str, int] = {}
        conv_tokens: dict[str, int] = {}
        conv_cost: dict[str, float] = {}
        conv_emp: dict[str, str] = {}
        conv_last_seen: dict[str, datetime] = {}
        for e in recent:
            cid = e.payload.get("conversation_id") if isinstance(e.payload, dict) else None
            if not isinstance(cid, str) or not cid:
                continue
            tok = e.payload.get("tokens")
            ti = to_t = tt = 0
            if isinstance(tok, dict):
                ti = int(tok.get("input", 0) or 0)
                to_t = int(tok.get("output", 0) or 0)
                tt = int(tok.get("total", 0) or 0) or (ti + to_t)
            elif isinstance(tok, int):
                tt = int(tok)
            mr = e.payload.get("model_ref") if isinstance(e.payload, dict) else None
            run_cost = estimate_cost_usd(
                mr if isinstance(mr, str) else None, ti, to_t, overlay=price_overlay
            )
            conv_runs[cid] = conv_runs.get(cid, 0) + 1
            conv_tokens[cid] = conv_tokens.get(cid, 0) + tt
            conv_cost[cid] = conv_cost.get(cid, 0.0) + run_cost
            emp_id = e.payload.get("employee_id") or e.actor
            if isinstance(emp_id, str) and cid not in conv_emp:
                conv_emp[cid] = emp_id
            prev_seen = conv_last_seen.get(cid)
            if prev_seen is None or e.published_at > prev_seen:
                conv_last_seen[cid] = e.published_at
        by_conversation = [
            ObservatoryConversationBreakdown(
                conversation_id=cid,
                employee_id=conv_emp.get(cid),
                employee_name=name_by_id.get(conv_emp.get(cid, "")),
                runs_count=conv_runs[cid],
                total_tokens=conv_tokens[cid],
                estimated_cost_usd=round(conv_cost[cid], 6),
                last_seen_at=conv_last_seen.get(cid),
            )
            for cid in sorted(conv_cost, key=lambda c: -conv_cost[c])[:8]
        ]

        return ObservatorySummary(
            traces_total=runs_total,
            failure_rate_24h=round(failure_rate, 4),
            latency_p50_s=round(p50, 3),
            latency_p95_s=round(p95, 3),
            latency_p99_s=round(p99, 3),
            avg_tokens_per_run=avg_tokens,
            input_tokens_total=input_total,
            output_tokens_total=output_total,
            total_tokens_total=total_total,
            llm_calls_total=llm_calls_total,
            estimated_cost_usd=round(cost_total, 6),
            runs_delta_pct=runs_delta,
            failure_rate_delta_pct=failure_delta,
            latency_p50_delta_pct=p50_delta,
            cost_delta_pct=cost_delta,
            by_employee=by_employee,
            by_model=by_model,
            by_tool=by_tool,
            top_errors=top_errors,
            by_conversation=by_conversation,
            latency_heatmap=latency_heatmap,
            latency_heatmap_buckets_s=latency_heatmap_buckets_s,
            anomalies=_compute_anomalies(
                p50,
                prev_p50,
                failure_rate,
                prev_failure_rate,
                runs_24h,
                prev_runs,
                top_errors,
            ),
        )

    async def list_traces(
        self,
        *,
        employee_id: str | None = None,
        model_ref: str | None = None,
        status: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        q: str | None = None,
        limit: int = 50,
    ) -> list[TraceSummary]:
        # Pull a generous window of events; each run produces ≥2 (started +
        # completed/failed), and we collapse them into one TraceSummary keyed
        # by ``payload.run_id`` so the listing is run-addressable rather than
        # event-addressable. Without this, click-through to /runs/{run_id}
        # 404s because event ids (`evt_…`) are not run ids.
        events = await self._events.list_recent(
            limit=max(limit * 8, 200),
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
            since=since,
        )
        employees = await self._employees.list_all()
        name_by_id = {e.id: e.name for e in employees}

        # Group by run_id; merge started + terminator into a single row.
        grouped: dict[str, dict[str, object]] = {}
        for e in events:
            if until is not None and e.published_at > until:
                continue
            run_id_raw = e.payload.get("run_id")
            # Production runs always set ``payload.run_id`` (chat_service.py
            # mints one per send_message). Legacy fixtures and test seeds may
            # omit it; we fall back to the event id so historical rows still
            # appear in the listing — they remain non-clickable but visible.
            run_id = run_id_raw if isinstance(run_id_raw, str) and run_id_raw else e.id
            slot = grouped.setdefault(run_id, {})
            emp = e.payload.get("employee_id") or e.actor
            if isinstance(emp, str) and "employee_id" not in slot:
                slot["employee_id"] = emp
            is_terminator = e.kind.endswith((".completed", ".failed", ".finished"))
            if e.kind.endswith(".started") and "started_at" not in slot:
                slot["started_at"] = e.published_at
            elif is_terminator:
                slot["terminator_kind"] = e.kind
                duration = e.payload.get("duration_s")
                if isinstance(duration, (int, float)):
                    slot["duration_s"] = float(duration)
                tokens = e.payload.get("tokens")
                if isinstance(tokens, dict):
                    ti = int(tokens.get("input", 0) or 0)
                    to = int(tokens.get("output", 0) or 0)
                    tt = int(tokens.get("total", 0) or 0) or (ti + to)
                    slot["input_tokens"] = ti
                    slot["output_tokens"] = to
                    slot["total_tokens"] = tt
                elif isinstance(tokens, int):
                    slot["total_tokens"] = int(tokens)
                model_ref = e.payload.get("model_ref")
                if isinstance(model_ref, str) and model_ref:
                    slot["model_ref"] = model_ref
                llm_calls = e.payload.get("llm_calls")
                if isinstance(llm_calls, int):
                    slot["llm_calls"] = llm_calls
                slot.setdefault("started_at", e.published_at)
            else:
                slot.setdefault("started_at", e.published_at)

        out: list[TraceSummary] = []
        for run_id, slot in grouped.items():
            eid_obj = slot.get("employee_id")
            eid: str | None = eid_obj if isinstance(eid_obj, str) else None
            if employee_id and eid != employee_id:
                continue
            # Three-state status:
            #   - run.failed terminator → "failed"
            #   - run.completed terminator → "ok"
            #   - run.started seen but no terminator → "running"
            terminator = slot.get("terminator_kind")
            if terminator == "run.failed":
                trace_status = "failed"
            elif terminator is not None:
                trace_status = "ok"
            else:
                trace_status = "running"
            if status and trace_status != status:
                continue
            started_at_obj = slot.get("started_at")
            if not isinstance(started_at_obj, datetime):
                continue
            duration_obj = slot.get("duration_s")
            input_tok = slot.get("input_tokens")
            output_tok = slot.get("output_tokens")
            total_tok = slot.get("total_tokens")
            mr_raw = slot.get("model_ref")
            model_ref_obj: str | None = mr_raw if isinstance(mr_raw, str) else None
            if model_ref and model_ref_obj != model_ref:
                continue
            if q:
                ql = q.lower()
                hay = " ".join(
                    s
                    for s in (
                        run_id,
                        eid or "",
                        name_by_id.get(eid, "") if eid else "",
                        model_ref_obj or "",
                        trace_status,
                    )
                    if s
                ).lower()
                if ql not in hay:
                    continue
            llm_calls_obj = slot.get("llm_calls")
            tokens_summary = RunTokenUsage(
                prompt=int(input_tok) if isinstance(input_tok, int) else 0,
                completion=int(output_tok) if isinstance(output_tok, int) else 0,
                total=int(total_tok) if isinstance(total_tok, int) else 0,
            )
            out.append(
                TraceSummary(
                    trace_id=run_id,
                    employee_id=eid,
                    employee_name=name_by_id.get(eid) if eid else None,
                    model_ref=model_ref_obj,
                    status=trace_status,
                    duration_s=float(duration_obj)
                    if isinstance(duration_obj, (int, float))
                    else None,
                    tokens=tokens_summary,
                    llm_calls=int(llm_calls_obj) if isinstance(llm_calls_obj, int) else 0,
                    started_at=started_at_obj,
                )
            )

        out.sort(key=lambda t: t.started_at, reverse=True)
        return out[:limit]

    async def get_trace(self, trace_id: str) -> TraceSummary | None:
        traces = await self.list_traces(limit=1000)
        for t in traces:
            if t.trace_id == trace_id:
                return t
        return None

    async def get_run_detail(self, run_id: str) -> RunDetail | None:
        """Reconstruct the full trace for a single run (spec 2026-04-21 §3).

        Sources:
        - ``messages`` (filtered by ``parent_run_id``) → ordered Turn[] of
          user input, thinking, tool_call (with its paired tool result), and
          final assistant message. See ``_compose_turns``.
        - ``events`` (``run.started`` / ``run.completed`` / ``run.failed``) →
          status, start/finish timestamps, duration, tokens, error payload.

        Returns ``None`` when neither messages nor a ``run.*`` event exist
        for the id. The UI surfaces that as a 404 on the wrapper route so
        stale ``?trace=`` URLs don't render an empty shell.
        """
        if self._conversations is None:
            raise RuntimeError(
                "ObservatoryService.get_run_detail requires conversation_repo; "
                "pass one in at construction time."
            )
        messages = await self._conversations.list_messages_by_run_id(run_id)
        events = await self._load_run_events(run_id)

        if not messages and not events:
            return None

        started_event = next((e for e in events if e.kind == "run.started"), None)
        terminator = next((e for e in events if e.kind in ("run.completed", "run.failed")), None)

        if messages:
            conversation_id = messages[0].conversation_id
        elif started_event is not None:
            cid = started_event.payload.get("conversation_id")
            conversation_id = cid if isinstance(cid, str) else ""
        else:
            conversation_id = ""

        employee_id: str | None = None
        for e in events:
            eid = e.payload.get("employee_id") or e.actor
            if isinstance(eid, str):
                employee_id = eid
                break

        employee_name: str | None = None
        if employee_id:
            emp = await self._employees.get(employee_id)
            if emp is not None:
                employee_name = emp.name

        task_id: str | None = None
        if self._tasks is not None:
            task = await self._tasks.get_by_run_id(run_id)
            if task is not None:
                task_id = task.id

        if messages:
            started_at = messages[0].created_at
        elif started_event is not None:
            started_at = started_event.published_at
        else:
            started_at = datetime.now(UTC)

        status: RunStatus
        finished_at: datetime | None = None
        duration_s: float | None = None
        error: RunError | None = None
        if terminator is not None:
            finished_at = terminator.published_at
            dur = terminator.payload.get("duration_s")
            if isinstance(dur, (int, float)):
                duration_s = float(dur)
            if terminator.kind == "run.failed":
                status = RunStatus.FAILED
                err_msg = terminator.payload.get("error")
                error = RunError(
                    message=str(err_msg) if err_msg else "Run failed (no message captured).",
                    kind=str(terminator.payload.get("error_kind") or "unknown"),
                )
            else:
                status = RunStatus.SUCCEEDED
        else:
            status = RunStatus.RUNNING

        tokens = RunTokenUsage()
        model_ref: str | None = None
        llm_calls_count = 0
        if terminator is not None:
            tok = terminator.payload.get("tokens")
            # New shape uses {input,output,total}; legacy single-int and
            # legacy {prompt,completion,total} both still appear in old
            # rows on disk, so we accept all three.
            if isinstance(tok, int):
                tokens = RunTokenUsage(prompt=0, completion=0, total=int(tok))
            elif isinstance(tok, dict):
                prompt = int(tok.get("input", tok.get("prompt", 0)) or 0)
                completion = int(tok.get("output", tok.get("completion", 0)) or 0)
                total = int(tok.get("total", 0) or 0) or (prompt + completion)
                tokens = RunTokenUsage(prompt=prompt, completion=completion, total=total)
            mr = terminator.payload.get("model_ref")
            if isinstance(mr, str) and mr:
                model_ref = mr
            lc = terminator.payload.get("llm_calls")
            if isinstance(lc, int):
                llm_calls_count = lc

        # Per-call telemetry · llm.call events emitted by chat_service for
        # each ``model.astream`` round-trip. We weave them into the turn
        # timeline using their wall-clock timestamp so the trace viewer can
        # show "LLM call #N · gpt-4o-mini · 3.2s · in 1.2k / out 420".
        llm_call_events = await self._load_run_kind_events(run_id, "llm.call")
        turns = _compose_turns(messages, llm_call_events)
        if model_ref is None:
            for ev in llm_call_events:
                ref = ev.payload.get("model_ref")
                if isinstance(ref, str) and ref:
                    model_ref = ref
                    break
        if llm_calls_count == 0 and llm_call_events:
            llm_calls_count = len(llm_call_events)

        # Artifacts created by this run · empty list when the artifact_repo
        # isn't wired (legacy callers / unit tests).
        artifacts: list[ArtifactSummary] = []
        if self._artifacts is not None:
            try:
                rows = await self._artifacts.list_by_run(run_id)
            except Exception:
                rows = []
            for a in rows:
                artifacts.append(
                    ArtifactSummary(
                        id=a.id,
                        name=a.name,
                        kind=a.kind.value if hasattr(a.kind, "value") else str(a.kind),
                        mime_type=a.mime_type,
                        version=a.version,
                        size_bytes=a.size_bytes,
                        pinned=a.pinned,
                        created_at=a.created_at,
                    )
                )

        price_overlay = await self._load_price_overlay()
        cost_estimate = estimate_cost_usd(
            model_ref, tokens.prompt, tokens.completion, overlay=price_overlay
        )

        return RunDetail(
            run_id=run_id,
            task_id=task_id,
            conversation_id=conversation_id,
            employee_id=employee_id,
            employee_name=employee_name,
            status=status,
            started_at=started_at,
            finished_at=finished_at,
            duration_s=duration_s,
            tokens=tokens,
            llm_calls=llm_calls_count,
            model_ref=model_ref,
            estimated_cost_usd=round(cost_estimate, 6),
            error=error,
            turns=turns,
            artifacts=artifacts,
        )

    async def _load_run_events(self, run_id: str) -> list[EventEnvelope]:
        """All ``run.*`` events matching ``payload.run_id``, oldest first."""
        recent = await self._events.list_recent(
            limit=500,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
        )
        matched = [e for e in recent if e.payload.get("run_id") == run_id]
        matched.sort(key=lambda e: e.published_at)
        return matched

    async def _load_run_kind_events(self, run_id: str, kind_prefix: str) -> list[EventEnvelope]:
        """Events of ``kind_prefix`` whose payload.run_id == run_id."""
        recent = await self._events.list_recent(
            limit=500,
            workspace_id=self._ws,
            kind_prefixes=[kind_prefix],
        )
        matched = [e for e in recent if e.payload.get("run_id") == run_id]
        matched.sort(key=lambda e: e.published_at)
        return matched

    async def update_flags(
        self,
        *,
        auto_title_enabled: bool | None = None,
    ) -> ObservabilityConfig:
        """Patch toggleable system flags on the singleton config row.

        Currently only ``auto_title_enabled`` is wired through; future
        platform-wide booleans land on this method so the REST `PATCH
        /api/observatory/config` body stays append-only.
        """
        cfg = await self._config.load()
        if auto_title_enabled is not None:
            cfg = cfg.model_copy(update={"auto_title_enabled": auto_title_enabled})
            cfg = await self._config.save(cfg)
        return cfg

    async def get_series(
        self,
        *,
        metric: str,
        since: datetime | None = None,
        until: datetime | None = None,
        bucket: str = "1h",
        employee_id: str | None = None,
        model_ref: str | None = None,
    ) -> TimeSeries:
        """Bucket run.* events into a time-series for the metric drilldown.

        Metrics:
        - ``runs`` · count of completed runs per bucket
        - ``failure_rate`` · failed/total within bucket (0-1)
        - ``latency_p50`` / ``latency_p95`` / ``latency_p99`` · seconds
        - ``tokens_total`` · sum of total_tokens
        - ``tokens_input`` / ``tokens_output`` · sum of in / out
        - ``llm_calls`` · sum of per-run llm_calls
        - ``cost`` · sum of estimated USD cost

        Buckets: ``"5m"`` (5 min) or ``"1h"``. Empty leading/trailing
        buckets are filled with zero points so the x-axis stays continuous
        for the chart.
        """
        ts_now = until or datetime.now(UTC)
        ts_start = since or (ts_now - timedelta(hours=24))
        # Bucket size in seconds (kept as a small whitelist — the UI only
        # ever asks for these; we reject anything else as 1h).
        bucket_seconds = 300 if bucket == "5m" else 3600
        bucket_size = timedelta(seconds=bucket_seconds)
        price_overlay = await self._load_price_overlay()

        events = await self._events.list_recent(
            limit=5000,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
            since=ts_start,
        )
        # Optional dimension filters · enables per-employee / per-model
        # drilldown charts on the detail pages.
        if employee_id is not None:
            events = [
                e
                for e in events
                if (
                    (e.payload.get("employee_id") if isinstance(e.payload, dict) else None)
                    == employee_id
                )
                or e.actor == employee_id
            ]
        if model_ref is not None:
            events = [
                e
                for e in events
                if (e.payload.get("model_ref") if isinstance(e.payload, dict) else None)
                == model_ref
            ]
        # Build empty buckets first so missing windows still render as 0.
        bucket_count = max(1, int((ts_now - ts_start).total_seconds() // bucket_seconds))
        bucket_ts: list[datetime] = [ts_start + bucket_size * i for i in range(bucket_count)]
        durs: list[list[float]] = [[] for _ in range(bucket_count)]
        runs = [0] * bucket_count
        failed = [0] * bucket_count
        tokens_in = [0] * bucket_count
        tokens_out = [0] * bucket_count
        tokens_total = [0] * bucket_count
        llm_calls = [0] * bucket_count
        cost = [0.0] * bucket_count

        for e in events:
            if e.published_at < ts_start or e.published_at > ts_now:
                continue
            idx = int((e.published_at - ts_start).total_seconds() // bucket_seconds)
            if not (0 <= idx < bucket_count):
                continue
            payload = e.payload
            if e.kind == "run.completed":
                runs[idx] += 1
            elif e.kind == "run.failed":
                runs[idx] += 1
                failed[idx] += 1
            else:
                continue
            dur = payload.get("duration_s")
            if isinstance(dur, (int, float)):
                durs[idx].append(float(dur))
            tok = payload.get("tokens")
            ti = to = tt = 0
            if isinstance(tok, dict):
                ti = int(tok.get("input", 0) or 0)
                to = int(tok.get("output", 0) or 0)
                tt = int(tok.get("total", 0) or 0) or (ti + to)
            elif isinstance(tok, int):
                tt = int(tok)
            tokens_in[idx] += ti
            tokens_out[idx] += to
            tokens_total[idx] += tt
            lc = payload.get("llm_calls")
            if isinstance(lc, int):
                llm_calls[idx] += lc
            mr = payload.get("model_ref")
            cost[idx] += estimate_cost_usd(
                mr if isinstance(mr, str) else None, ti, to, overlay=price_overlay
            )

        unit_by_metric = {
            "runs": "",
            "failure_rate": "%",
            "latency_p50": "s",
            "latency_p95": "s",
            "latency_p99": "s",
            "tokens_total": "tokens",
            "tokens_input": "tokens",
            "tokens_output": "tokens",
            "llm_calls": "",
            "cost": "USD",
        }
        unit = unit_by_metric.get(metric, "")

        points: list[TimeSeriesPoint] = []
        for i, ts_bucket in enumerate(bucket_ts):
            n = runs[i]
            value = 0.0
            if metric == "runs":
                value = float(n)
            elif metric == "failure_rate":
                value = float(failed[i]) / n if n else 0.0
            elif metric == "latency_p50":
                value = _percentile(durs[i], 0.5) if durs[i] else 0.0
            elif metric == "latency_p95":
                value = _percentile(durs[i], 0.95) if durs[i] else 0.0
            elif metric == "latency_p99":
                value = _percentile(durs[i], 0.99) if durs[i] else 0.0
            elif metric == "tokens_total":
                value = float(tokens_total[i])
            elif metric == "tokens_input":
                value = float(tokens_in[i])
            elif metric == "tokens_output":
                value = float(tokens_out[i])
            elif metric == "llm_calls":
                value = float(llm_calls[i])
            elif metric == "cost":
                value = cost[i]
            points.append(
                TimeSeriesPoint(
                    ts=ts_bucket,
                    value=round(value, 6),
                    count=n,
                )
            )

        return TimeSeries(
            metric=metric,
            bucket=bucket if bucket in ("5m", "1h") else "1h",
            since=ts_start,
            until=ts_now,
            points=points,
            unit=unit,
        )


def _compose_turns(
    messages: list[Message],
    llm_call_events: list[EventEnvelope] | None = None,
) -> list[Turn]:
    """Project persisted ``messages`` into the Turn union the UI renders.

    Rules (spec 2026-04-21 §3.2):
    - ``role=user`` → ``user_input``
    - ``role=assistant`` with reasoning → ``thinking`` first
    - ``role=assistant`` with ``tool_calls`` → one ``tool_call`` per entry
      (result starts empty, filled by the next ``role=tool`` message whose
      ``tool_call_id`` matches)
    - ``role=assistant`` with plain content → ``message``
    - ``role=system`` → skipped (summary markers, bootstrap notes)

    Plus: every ``llm.call`` event becomes a ``TurnLLMCall`` placed by
    timestamp (so the timeline shows "LLM call #1 → tools → LLM call #2 →
    assistant text" in the order the agent actually executed).

    Any parsing hiccup falls through to a plain ``message`` turn so the
    viewer always shows *something*.
    """
    turns: list[Turn] = []
    pending_tool_turns: dict[str, TurnToolCall] = {}
    turn_indices: dict[str, int] = {}

    for msg in messages:
        if msg.role == "user":
            turns.append(TurnUserInput(content=msg.content, ts=msg.created_at))
            continue
        if msg.role == "system":
            continue
        if msg.role == "tool":
            tc_id = msg.tool_call_id or ""
            pending = pending_tool_turns.get(tc_id)
            if pending is None:
                continue
            idx = turn_indices[tc_id]
            try:
                import json

                parsed = json.loads(msg.content) if msg.content else msg.content
            except (ValueError, TypeError):
                parsed = msg.content
            updated = pending.model_copy(update={"result": parsed, "ts_returned": msg.created_at})
            turns[idx] = updated
            pending_tool_turns.pop(tc_id, None)
            turn_indices.pop(tc_id, None)
            continue
        if msg.role == "assistant":
            if msg.reasoning:
                turns.append(TurnThinking(content=msg.reasoning, ts=msg.created_at))
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    turn = TurnToolCall(
                        tool_call_id=tc.id,
                        name=tc.tool_id,
                        args=tc.args,
                        result=tc.result,
                        error=tc.error,
                        ts_called=msg.created_at,
                        ts_returned=None,
                    )
                    turns.append(turn)
                    if tc.result is None and tc.error is None:
                        pending_tool_turns[tc.id] = turn
                        turn_indices[tc.id] = len(turns) - 1
            elif msg.content:
                turns.append(TurnMessage(content=msg.content, ts=msg.created_at))
            continue

    # Weave llm.call events in by timestamp so they sort naturally next to
    # the assistant / tool turns they generated. We append them all and
    # re-sort the whole list — Turn instances expose ``ts`` consistently
    # (the ``.ts`` field on every variant), and a stable sort keeps tool
    # call/result pairs adjacent when timestamps tie.
    if llm_call_events:
        for idx, ev in enumerate(llm_call_events, start=1):
            payload = ev.payload
            tok = payload.get("tokens") if isinstance(payload, dict) else None
            ti = to = tt = 0
            if isinstance(tok, dict):
                ti = int(tok.get("input", 0) or 0)
                to = int(tok.get("output", 0) or 0)
                tt = int(tok.get("total", 0) or 0) or (ti + to)
            call_index = payload.get("call_index") if isinstance(payload, dict) else None
            duration = payload.get("duration_s") if isinstance(payload, dict) else None
            model_ref = payload.get("model_ref") if isinstance(payload, dict) else None
            turns.append(
                TurnLLMCall(
                    call_index=int(call_index) if isinstance(call_index, int) else idx,
                    model_ref=str(model_ref) if isinstance(model_ref, str) else None,
                    duration_s=float(duration) if isinstance(duration, (int, float)) else 0.0,
                    input_tokens=ti,
                    output_tokens=to,
                    total_tokens=tt,
                    ts=ev.published_at,
                )
            )
        turns.sort(key=_turn_sort_key)

    return turns


def _turn_sort_key(turn: Turn) -> datetime:
    """``Turn.ts`` for everything except ``TurnToolCall`` which uses
    ``ts_called`` instead — the union doesn't share a single field name."""
    if isinstance(turn, TurnToolCall):
        return turn.ts_called
    return turn.ts


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = int(len(s) * pct)
    if idx >= len(s):
        idx = len(s) - 1
    return s[idx]


def _compute_anomalies(
    p50_now: float,
    p50_prev: float,
    failure_rate_now: float,
    failure_rate_prev: float,
    runs_now: int,
    runs_prev: int,
    top_errors: list[ObservatoryErrorBreakdown],
) -> list[str]:
    """Small explainable rule set for "things look off" callouts.

    No ML, no black box — each rule is one comparison the user can audit
    in the dashboard themselves. The strings are i18n-keys-not-yet so the
    UI just renders them as informational chips for now.
    """
    out: list[str] = []
    if p50_prev > 0 and p50_now > p50_prev * 2 and p50_now > 1.0:
        out.append(
            f"latency.p50 {p50_now:.2f}s vs {p50_prev:.2f}s yesterday "
            f"(+{((p50_now - p50_prev) / p50_prev) * 100:.0f}%)"
        )
    if failure_rate_now > 0.10 and failure_rate_now > failure_rate_prev + 0.05:
        out.append(
            f"failure_rate {failure_rate_now * 100:.1f}% vs "
            f"{failure_rate_prev * 100:.1f}% yesterday"
        )
    if runs_prev > 5 and runs_now < runs_prev * 0.5:
        out.append(
            f"runs/24h {runs_now} vs {runs_prev} yesterday "
            f"(-{((runs_prev - runs_now) / runs_prev) * 100:.0f}%) — "
            f"traffic dropped"
        )
    # Surface the top failure category if it dominates.
    if top_errors:
        top = top_errors[0]
        total_err = sum(e.count for e in top_errors)
        if total_err >= 5 and top.count / total_err > 0.6:
            out.append(
                f"top error '{top.error_kind}' = {top.count}/{total_err} "
                f"failures (>60% concentration)"
            )
    return out


__all__ = [
    "ObservatoryService",
]

"""ObservatoryService — summary + trace listing + bootstrap orchestration.

Spec `docs/specs/agent-design/2026-04-18-observatory.md` § 5 - § 8.

v0 MVP scope (delivered this wave):
- `get_summary()` aggregates `events` + `observability_config` into an
  `ObservatorySummary` so `/observatory` and `observatory.get_status` return
  consistent numbers.
- `list_traces(filter)` / `get_trace(id)` read from the local `events` table
  filtered on `run.*` kinds. Once the Langfuse HTTP API client lands the
  implementation swaps over without touching callers.
- `get_status()` / `bootstrap_now()` expose the singleton
  `observability_config` row.

Deferred to a follow-up (Langfuse wave 2):
- 8-step Langfuse bootstrap orchestration (spec § 5.1)
- CallbackHandler hot-reload (spec § 5.4)
- iframe session proxy (spec § 6.3)
- AES-256-GCM wrapping of `secret_key` / `admin_password`

This is the L01 shared implementation — both `api/routers/observatory.py`
and the 4 Meta Tools in `execution/tools/meta/observatory_tools.py` delegate
here so REST and Lead Agent can never drift.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from allhands.core import (
    ArtifactSummary,
    BootstrapStatus,
    Message,
    ObservabilityConfig,
    ObservatoryEmployeeBreakdown,
    ObservatoryModelBreakdown,
    ObservatorySummary,
    RunDetail,
    RunError,
    RunStatus,
    RunTokenUsage,
    TraceSummary,
    Turn,
    TurnLLMCall,
    TurnMessage,
    TurnThinking,
    TurnToolCall,
    TurnUserInput,
)

if TYPE_CHECKING:
    from allhands.core import EventEnvelope
    from allhands.persistence.repositories import (
        ArtifactRepo,
        ConversationRepo,
        EmployeeRepo,
        EventRepo,
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
        workspace_id: str = "default",
    ) -> None:
        self._events = event_repo
        self._employees = employee_repo
        self._config = config_repo
        # Optional for back-compat with callers that only need summary/list
        # (the 4 Meta Tools). The `/runs/{id}` route passes both; get_run_detail
        # will raise a clear error if either is missing.
        self._conversations = conversation_repo
        self._tasks = task_repo
        # Optional artifact repo · enables the "产出制品" panel on RunDetail.
        # When None the field stays empty; the drawer just hides the section.
        self._artifacts = artifact_repo
        self._ws = workspace_id

    async def get_status(self) -> ObservabilityConfig:
        return await self._config.load()

    async def get_summary(self, *, now: datetime | None = None) -> ObservatorySummary:
        ts_now = now or datetime.now(UTC)
        day_start = ts_now - timedelta(hours=24)

        cfg = await self._config.load()

        runs_total = await self._events.count_since(
            since=datetime.fromtimestamp(0, tz=UTC),
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
        )
        runs_24h = await self._events.count_since(
            since=day_start,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
        )
        failed_24h = await self._events.count_since(
            since=day_start,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_FAILED_KINDS),
        )

        failure_rate = (failed_24h / runs_24h) if runs_24h else 0.0

        recent = await self._events.list_recent(
            limit=1000,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
            since=day_start,
        )
        durations = [
            float(e.payload["duration_s"])
            for e in recent
            if isinstance(e.payload.get("duration_s"), (int, float))
        ]
        p50 = _percentile(durations, 0.5) if durations else 0.0

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
        emp_stats: dict[str, dict[str, int]] = {}
        model_stats: dict[str, dict[str, int]] = {}
        for e in recent:
            tok = e.payload.get("tokens")
            ti = to = tt = 0
            if isinstance(tok, dict):
                ti = int(tok.get("input", 0) or 0)
                to = int(tok.get("output", 0) or 0)
                tt = int(tok.get("total", 0) or 0) or (ti + to)
            elif isinstance(tok, int):
                tt = int(tok)
            emp_id = e.payload.get("employee_id") or e.actor
            if isinstance(emp_id, str):
                slot = emp_stats.setdefault(
                    emp_id, {"runs": 0, "input": 0, "output": 0, "total": 0}
                )
                slot["runs"] += 1
                slot["input"] += ti
                slot["output"] += to
                slot["total"] += tt
            model_ref = e.payload.get("model_ref")
            if isinstance(model_ref, str) and model_ref:
                m = model_stats.setdefault(
                    model_ref, {"runs": 0, "input": 0, "output": 0, "total": 0}
                )
                m["runs"] += 1
                m["input"] += ti
                m["output"] += to
                m["total"] += tt

        by_employee = [
            ObservatoryEmployeeBreakdown(
                employee_id=eid,
                employee_name=name_by_id.get(eid, eid),
                runs_count=stats["runs"],
                input_tokens=stats["input"],
                output_tokens=stats["output"],
                total_tokens=stats["total"],
            )
            for eid, stats in sorted(emp_stats.items(), key=lambda kv: -kv[1]["runs"])
        ]
        by_model = [
            ObservatoryModelBreakdown(
                model_ref=ref,
                runs_count=stats["runs"],
                input_tokens=stats["input"],
                output_tokens=stats["output"],
                total_tokens=stats["total"],
            )
            for ref, stats in sorted(model_stats.items(), key=lambda kv: -kv[1]["runs"])
        ]

        return ObservatorySummary(
            traces_total=runs_total,
            failure_rate_24h=round(failure_rate, 4),
            latency_p50_s=round(p50, 3),
            avg_tokens_per_run=avg_tokens,
            input_tokens_total=input_total,
            output_tokens_total=output_total,
            total_tokens_total=total_total,
            llm_calls_total=llm_calls_total,
            by_employee=by_employee,
            by_model=by_model,
            observability_enabled=cfg.observability_enabled,
            bootstrap_status=cfg.bootstrap_status,
            bootstrap_error=cfg.bootstrap_error,
            host=cfg.host,
        )

    async def list_traces(
        self,
        *,
        employee_id: str | None = None,
        status: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
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

    async def bootstrap_now(self) -> ObservabilityConfig:
        """Idempotent status refresh (spec § 7 BOOTSTRAP semantics).

        v0 MVP: returns current config without touching Langfuse. When the
        8-step bootstrap service lands it replaces this body; the tool +
        REST contract stays identical because both call through this method.
        """
        return await self._config.load()


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


__all__ = [
    "BootstrapStatus",
    "ObservatoryService",
]

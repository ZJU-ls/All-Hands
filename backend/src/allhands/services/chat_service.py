"""ChatService — the core use case: user sends a message, agent streams back."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from allhands.core import Conversation, Employee, Message, RenderPayload, ToolCall
from allhands.core.errors import DomainError, EmployeeNotFound
from allhands.core.run_overrides import RunOverrides
from allhands.execution.dispatch import DispatchService
from allhands.execution.runner import AgentRunner
from allhands.execution.skills import SkillRuntime, bootstrap_employee_runtime
from allhands.execution.tools.meta.spawn_subagent import SpawnSubagentService

log = logging.getLogger(__name__)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.execution.event_bus import EventBus
    from allhands.execution.events import AgentEvent
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.skills import SkillRegistry
    from allhands.persistence.repositories import (
        ConversationRepo,
        EmployeeRepo,
        LLMProviderRepo,
        MCPServerRepo,
        SkillRuntimeRepo,
    )


DEFAULT_COMPACT_KEEP_LAST = 20
MIN_COMPACT_THRESHOLD = 4

# Cap the first-line snippet shown in the cockpit activity feed — the feed
# row is tight and a long reply would wrap into the next card.
_TURN_SUMMARY_MAX_CHARS = 80


def _summarize_turn(content: str, employee: Employee | None) -> str:
    first_line = content.strip().splitlines()[0] if content.strip() else ""
    snippet = first_line[:_TURN_SUMMARY_MAX_CHARS]
    if len(first_line) > _TURN_SUMMARY_MAX_CHARS:
        snippet += "…"
    prefix = f"{employee.name} · " if employee and employee.name else ""
    return f"{prefix}{snippet}" if snippet else f"{prefix}(空回复)"


@dataclass(frozen=True)
class CompactResult:
    """Outcome of compact_conversation.

    ``dropped`` is the number of messages deleted from the tail; ``summary_id``
    is the synthetic system-role marker inserted in their place (None if nothing
    was compacted).
    """

    dropped: int
    summary_id: str | None
    messages: list[Message]


class ChatService:
    def __init__(
        self,
        employee_repo: EmployeeRepo,
        conversation_repo: ConversationRepo,
        tool_registry: ToolRegistry,
        skill_registry: SkillRegistry,
        gate: BaseGate,
        provider_repo: LLMProviderRepo | None = None,
        bus: EventBus | None = None,
        skill_runtime_repo: SkillRuntimeRepo | None = None,
        mcp_repo: MCPServerRepo | None = None,
        checkpointer: Any | None = None,
    ) -> None:
        self._employees = employee_repo
        self._conversations = conversation_repo
        self._tools = tool_registry
        self._skills = skill_registry
        self._gate = gate
        self._providers = provider_repo
        # For the Lead capability-snapshot (L12 / E20). Optional because
        # unit tests don't always wire an MCP repo; snapshot degrades
        # gracefully with "mcp_servers: unknown".
        self._mcp_repo = mcp_repo
        # Optional: lets chat turns surface in the cockpit activity feed.
        # The bus lives on the trigger_runtime singleton; we accept None so
        # CLI / test constructions (no FastAPI Request) still work.
        self._bus = bus
        # ADR 0011 · principle 7 state-checkpointable: runtime cache is the
        # hot path; on miss we fall through to the repo so uvicorn reload
        # doesn't wipe activated skills. `None` keeps legacy test constructions
        # (no DB) working — cache becomes the only store, which is the pre-v1
        # behaviour.
        self._skill_runtime_repo = skill_runtime_repo
        # Per-conversation runtime · persists resolve_skill mutations across
        # send_message calls (contract § 8.2 · V02 query() main loop carries
        # the live tool pool turn-to-turn).
        self._runtime_cache: dict[str, SkillRuntime] = {}
        # ADR 0014 · LangGraph checkpointer for graph-internal state (interrupt
        # resume / tool pending / subagent stack). Separate from MessageRepo
        # which stays the SoT for user-visible messages (R2). None in v0-compat
        # mode; populated once ALLHANDS_ENABLE_CHECKPOINTER is flipped on.
        self._checkpointer = checkpointer

    async def _compute_platform_snapshot(self) -> str:
        """Fresh DB-verified snapshot of platform capabilities, injected into
        every Lead Agent turn (E20 / L12).

        Root problem: even with a "Capability-discovery protocol" block in the
        Lead prompt (L06), the model routinely hallucinates "平台目前没配置
        任何 LLM 提供商 / 技能 / MCP 服务器" when the DB clearly has them.
        Prompt-level "must call list_* first" is a soft norm the LLM silently
        skips. The reliable fix is programmatic: compute the snapshot on the
        service side and inject it as a system prefix — the LLM can't
        hallucinate numbers that are sitting right in its context.

        Format is compact (≤ 8 lines, ≤ 600 chars) so it doesn't bloat the
        prompt budget. We surface top-level counts + the first item of each
        kind (enough to ground "has at least one provider / skill / ...");
        Lead can still `list_*` for full detail if the user asks.

        Best-effort: any repo miss is logged and the field is omitted. A
        snapshot failure must not block the chat turn.
        """
        lines: list[str] = []

        # Providers (+ which one is the default / its kind / model)
        if self._providers is not None:
            try:
                provs = await self._providers.list_all()
                if provs:
                    default = next((p for p in provs if p.is_default), None) or provs[0]
                    lines.append(
                        f"- providers: {len(provs)} configured · default = "
                        f"{default.name} (kind={default.kind}, model={default.default_model})"
                    )
                else:
                    lines.append("- providers: 0 — none configured yet")
            except Exception:
                log.exception("snapshot · providers.list_all failed")

        # Skills (descriptor list is already lazy-loaded and in memory)
        try:
            descriptors = self._skills.list_descriptors()
            if descriptors:
                names = ", ".join(d.name for d in descriptors[:4])
                more = f" (+{len(descriptors) - 4} more)" if len(descriptors) > 4 else ""
                lines.append(f"- skills: {len(descriptors)} installed — {names}{more}")
            else:
                lines.append("- skills: 0 installed")
        except Exception:
            log.exception("snapshot · skills.list_descriptors failed")

        # MCP servers
        if self._mcp_repo is not None:
            try:
                mcps = await self._mcp_repo.list_all()
                if mcps:
                    names = ", ".join(m.name for m in mcps[:4])
                    more = f" (+{len(mcps) - 4} more)" if len(mcps) > 4 else ""
                    lines.append(f"- mcp_servers: {len(mcps)} registered — {names}{more}")
                else:
                    lines.append("- mcp_servers: 0 registered")
            except Exception:
                log.exception("snapshot · mcp.list_all failed")

        # Employees (exclude Lead itself — Lead knows it exists)
        try:
            emps = await self._employees.list_all()
            non_lead = [e for e in emps if not e.is_lead_agent]
            names = ", ".join(e.name for e in non_lead[:4])
            more = f" (+{len(non_lead) - 4} more)" if len(non_lead) > 4 else ""
            if non_lead:
                lines.append(f"- employees (non-lead): {len(non_lead)} — {names}{more}")
            else:
                lines.append("- employees (non-lead): 0 — only the Lead Agent exists")
        except Exception:
            log.exception("snapshot · employees.list_all failed")

        if not lines:
            return ""
        return (
            "# Current platform snapshot (fresh · DB-verified)\n" + "\n".join(lines) + "\n\n"
            "Use the numbers above to answer capability questions directly "
            "— they are accurate right now. Only call list_* when you need "
            "full detail of a specific item (e.g. the description of a skill, "
            "the health of an MCP, the system_prompt of an employee). "
            'Answering "0 of each" when this snapshot says otherwise is a bug.'
        )

    async def get_or_load_runtime(self, conversation_id: str, employee: Employee) -> SkillRuntime:
        """Cache-first, repo-fallthrough, bootstrap as last resort.

        Exposed for tests (and future read-only callers); ``send_message``
        calls it inline. Returns the cached instance when present so runner
        mutations (resolve_skill) land on the same object the next turn
        observes.
        """
        runtime = self._runtime_cache.get(conversation_id)
        if runtime is not None:
            return runtime
        if self._skill_runtime_repo is not None:
            persisted = await self._skill_runtime_repo.load(conversation_id)
            if persisted is not None:
                self._runtime_cache[conversation_id] = persisted
                return persisted
        runtime = bootstrap_employee_runtime(employee, self._skills, self._tools)
        self._runtime_cache[conversation_id] = runtime
        return runtime

    async def _flush_runtime(self, conversation_id: str) -> None:
        """Write the live runtime back to the repo (best-effort · logs on fail).

        Called from ``send_message`` after ``runner.stream()`` finishes so any
        ``resolve_skill`` mutations made during the turn survive a restart.
        """
        if self._skill_runtime_repo is None:
            return
        runtime = self._runtime_cache.get(conversation_id)
        if runtime is None:
            return
        try:
            await self._skill_runtime_repo.save(conversation_id, runtime)
        except Exception:
            # Persistence failure must not block streaming the reply back to
            # the user. Worst case: the runtime is cache-only for this process
            # lifetime, identical to pre-v1 behaviour.
            log.exception(
                "Failed to flush SkillRuntime",
                extra={"conversation_id": conversation_id},
            )

    async def list_messages(self, conversation_id: str) -> list[Message]:
        conv = await self._conversations.get(conversation_id)
        if conv is None:
            raise DomainError(f"Conversation {conversation_id!r} not found.")
        return await self._conversations.list_messages(conversation_id)

    async def compact_conversation(
        self,
        conversation_id: str,
        keep_last: int = DEFAULT_COMPACT_KEEP_LAST,
    ) -> CompactResult:
        """Deterministically collapse earlier messages into a summary marker.

        No LLM call — this is the cheap, always-available lever. The agent's
        next turn will read a shorter history (N kept + 1 synthetic system
        marker) so the prompt token budget drops immediately. A future track
        can swap in an LLM summarisation path; this function's contract
        (return shape + side-effects) stays stable so the UI doesn't have to
        change.

        The runtime cache for this conversation is cleared because the live
        SkillRuntime's "which tools are currently resolved" state was built
        against the old history. Letting it persist would surface skills the
        user can no longer see a trace of, which violates P05 (don't let
        hidden state surprise the user).
        """

        if keep_last < MIN_COMPACT_THRESHOLD:
            raise DomainError(f"keep_last must be >= {MIN_COMPACT_THRESHOLD}; got {keep_last}")

        conv = await self._conversations.get(conversation_id)
        if conv is None:
            raise DomainError(f"Conversation {conversation_id!r} not found.")

        messages = await self._conversations.list_messages(conversation_id)
        if len(messages) <= keep_last:
            return CompactResult(dropped=0, summary_id=None, messages=messages)

        to_drop = messages[:-keep_last]
        to_keep = messages[-keep_last:]

        earliest_kept = to_keep[0].created_at
        # 1µs earlier so ORDER BY created_at ASC surfaces the summary before
        # the first kept turn.
        summary_created_at = earliest_kept - timedelta(microseconds=1)
        summary = Message(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            role="system",
            content=f"[系统] 已压缩 {len(to_drop)} 条较早消息以节省上下文。",
            created_at=summary_created_at,
        )

        await self._conversations.delete_messages([m.id for m in to_drop])
        await self._conversations.append_message(summary)

        # Two-sided clear: cache + repo (ADR 0011 · principle 7). Letting the
        # persisted runtime survive a compact would resurrect skills the user
        # no longer has history for on the next process restart — violating
        # P05 (no hidden state surprises).
        self._runtime_cache.pop(conversation_id, None)
        if self._skill_runtime_repo is not None:
            try:
                await self._skill_runtime_repo.delete(conversation_id)
            except Exception:
                log.exception(
                    "Failed to delete SkillRuntime on compact",
                    extra={"conversation_id": conversation_id},
                )

        new_messages = await self._conversations.list_messages(conversation_id)
        return CompactResult(
            dropped=len(to_drop),
            summary_id=summary.id,
            messages=new_messages,
        )

    async def create_conversation(self, employee_id: str) -> Conversation:
        conv = Conversation(
            id=str(uuid.uuid4()),
            employee_id=employee_id,
            created_at=datetime.now(UTC),
        )
        return await self._conversations.create(conv)

    async def send_message(
        self,
        conversation_id: str,
        user_content: str,
        overrides: RunOverrides | None = None,
    ) -> AsyncIterator[AgentEvent]:
        conv = await self._conversations.get(conversation_id)
        if conv is None:
            raise DomainError(f"Conversation {conversation_id!r} not found.")

        employee = await self._employees.get(conv.employee_id)
        if employee is None:
            raise EmployeeNotFound(f"Employee {conv.employee_id!r} not found.")

        # Each send_message call is one "run". We mint a run_id up front so
        # user + assistant messages can be tagged with parent_run_id (the key
        # the trace viewer joins on) and the event bus can publish a matching
        # run.started / run.completed pair. Before this wiring, run ids only
        # existed for seed fixtures and stubbed trigger handlers, so real
        # chat runs never produced observatory entries.
        run_id = f"run_{uuid.uuid4().hex[:16]}"
        run_started_at = datetime.now(UTC)

        user_msg = Message(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            role="user",
            content=user_content,
            parent_run_id=run_id,
            created_at=run_started_at,
        )
        await self._conversations.append_message(user_msg)

        if self._bus is not None:
            # E18: fire-and-forget so a contended events-table write doesn't
            # stall the SSE response before any token streams.
            self._bus.publish_best_effort(
                kind="run.started",
                payload={
                    "run_id": run_id,
                    "employee_id": employee.id,
                    "conversation_id": conversation_id,
                    "depth": 0,
                },
            )

        runtime = await self.get_or_load_runtime(conversation_id, employee)

        history = await self._conversations.list_messages(conversation_id)
        lc_messages: list[dict[str, Any]] = [
            {"role": m.role, "content": m.content}
            for m in history
            if m.role in ("user", "assistant")
        ]

        provider = None
        if self._providers is not None:
            provider = await self._providers.get_default()

        # E20 / L12: Lead turns get a fresh DB-verified snapshot injected as
        # the very first system segment (prepended via RunOverrides.system_override
        # — runner puts override_text above the employee's base prompt). This
        # prevents the "0 of each" hallucination that the prompt-only L06 fix
        # couldn't stop. Non-lead employees get nothing (their work is narrow;
        # flooding them with platform meta would add noise, not signal).
        if employee.is_lead_agent:
            snapshot = await self._compute_platform_snapshot()
            if snapshot:
                caller_override = (overrides.system_override or "").strip() if overrides else ""
                combined = snapshot + ("\n\n---\n\n" + caller_override if caller_override else "")
                base_overrides = overrides or RunOverrides()
                overrides = base_overrides.model_copy(update={"system_override": combined})

        runner_factory = self._build_runner_factory(provider)
        dispatch_service = DispatchService(
            employee_repo=self._employees,
            runner_factory=runner_factory,
        )
        spawn_subagent_service = SpawnSubagentService(
            employee_repo=self._employees,
            runner_factory=runner_factory,
        )
        runner = AgentRunner(
            employee=employee,
            tool_registry=self._tools,
            gate=self._gate,
            provider=provider,
            dispatch_service=dispatch_service,
            skill_registry=self._skills,
            runtime=runtime,
            spawn_subagent_service=spawn_subagent_service,
            model_ref_override=conv.model_ref_override,
            checkpointer=self._checkpointer,
        )
        return self._persist_assistant_reply(
            conversation_id,
            runner.stream(
                messages=lc_messages,
                thread_id=conversation_id,
                overrides=overrides,
            ),
            employee=employee,
            run_id=run_id,
            run_started_at=run_started_at,
        )

    async def _persist_assistant_reply(
        self,
        conversation_id: str,
        stream: AsyncIterator[AgentEvent],
        *,
        employee: Employee | None = None,
        run_id: str | None = None,
        run_started_at: datetime | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """Tap the runner stream, persist the assistant's reply to the DB.

        Without this, assistant replies evaporate the moment the SSE stream
        closes — the next turn reloads history via ``list_messages`` (see the
        replay in ``send_message``) and sees N user messages with 0 answers.
        The React agent interprets each prior user turn as unanswered and
        re-replies to all of them, surfacing as the "AI keeps re-answering
        old questions" bug.

        Contract: exactly one assistant ``Message`` row is appended per
        ``send_message`` call, keyed by the runner's per-turn ``message_id``.
        Content is the concatenation of all ``TokenEvent.delta`` seen;
        reasoning (thinking-channel) chunks land in ``message.reasoning`` so
        the trace viewer can replay them after the SSE closes. Tool calls
        still get their own schema later. On client disconnect / runtime
        cancellation the ``finally`` block still salvages whatever partial
        content was accumulated so history stays internally consistent.
        """
        buffer: list[str] = []
        reasoning_buffer: list[str] = []
        # Historical-rehydrate fix: render + tool_call events fire during the
        # live SSE but until now never landed on the persisted Message row,
        # so a page reload showed the assistant's prose without the charts /
        # cards the agent drew and without the inline system-tool chips. We
        # aggregate them keyed off the per-turn message_id so each turn's row
        # captures exactly what the live UI saw.
        render_payloads: list[RenderPayload] = []
        tool_calls_by_id: dict[str, ToolCall] = {}
        message_id: str | None = None
        first_seen: datetime | None = None
        persisted = False
        run_finalized = False
        error_payload: dict[str, object] | None = None

        async def flush() -> None:
            nonlocal persisted
            if persisted or not buffer or message_id is None:
                return
            persisted = True
            content = "".join(buffer)
            reasoning_text = "".join(reasoning_buffer) or None
            msg = Message(
                id=message_id,
                conversation_id=conversation_id,
                role="assistant",
                content=content,
                reasoning=reasoning_text,
                parent_run_id=run_id,
                render_payloads=list(render_payloads),
                tool_calls=list(tool_calls_by_id.values()),
                created_at=first_seen or datetime.now(UTC),
            )
            try:
                await self._conversations.append_message(msg)
            except Exception:
                log.exception(
                    "Failed to persist assistant reply",
                    extra={"conversation_id": conversation_id, "message_id": message_id},
                )
                return
            # Publish a cockpit beat for the activity feed. Fire-and-forget
            # (E18): awaiting this added 3-5 s between the last token and
            # RUN_FINISHED because the bus writes on a separate DB session
            # that contends with the request session for the SQLite write
            # lock. The user already saw the reply; cockpit telemetry is
            # secondary signal, safe to run in the background.
            if self._bus is not None:
                self._bus.publish_best_effort(
                    kind="conversation.turn_completed",
                    payload={
                        "conversation_id": conversation_id,
                        "message_id": message_id,
                        "employee_id": employee.id if employee else None,
                        "employee_name": employee.name if employee else None,
                        "summary": _summarize_turn(content, employee),
                        "link": f"/chat/{conversation_id}",
                    },
                )

        async def finalize_run() -> None:
            nonlocal run_finalized
            if run_finalized or run_id is None or self._bus is None:
                return
            run_finalized = True
            duration_s: float | None = None
            if run_started_at is not None:
                duration_s = (datetime.now(UTC) - run_started_at).total_seconds()
            failed = error_payload is not None
            # E18: fire-and-forget. This runs in the finally of the SSE
            # stream generator; awaiting a contended bus write would delay
            # transport close by 3-5 s for no user-facing benefit.
            self._bus.publish_best_effort(
                kind="run.failed" if failed else "run.completed",
                payload={
                    "run_id": run_id,
                    "employee_id": employee.id if employee else None,
                    "conversation_id": conversation_id,
                    "duration_s": duration_s,
                    "error": error_payload.get("message") if error_payload else None,
                },
            )

        try:
            async for event in stream:
                if event.kind == "token":
                    buffer.append(event.delta)
                    message_id = event.message_id
                    if first_seen is None:
                        first_seen = datetime.now(UTC)
                elif event.kind == "reasoning":
                    reasoning_buffer.append(event.delta)
                    if message_id is None:
                        message_id = event.message_id
                elif event.kind == "render":
                    # Aggregate render envelopes in arrival order — this is
                    # also the order the live UI rendered them. If the turn
                    # emits multiple (e.g. table + callout), all land on the
                    # same message row so reloading preserves the sequence.
                    render_payloads.append(event.payload)
                    if message_id is None:
                        message_id = event.message_id
                elif event.kind == "tool_call_end":
                    # L14 · system-tool inline chips + external tool cards
                    # both rehydrate from this list. Keyed by tool_call.id so
                    # a later terminal state (e.g. confirmation-approved) can
                    # overwrite an earlier running snapshot within the same
                    # turn without duplicating rows.
                    tc = event.tool_call
                    tool_calls_by_id[tc.id] = tc
                elif event.kind == "error":
                    error_payload = {"code": event.code, "message": event.message}
                    await flush()
                elif event.kind == "done":
                    await flush()
                yield event
        finally:
            await flush()
            await finalize_run()
            # ADR 0011 · principle 7: flush any resolve_skill mutations made
            # during this turn so a uvicorn reload doesn't wipe them. Runs
            # after finalize_run so the cockpit event doesn't block on a DB
            # round-trip, and after flush() so the assistant message is
            # durable first (if this errors, at least the reply is saved).
            await self._flush_runtime(conversation_id)

    def _build_runner_factory(self, provider: Any) -> Any:
        """Closure used by DispatchService to spawn sub-runners.

        The sub-runner carries the same tool registry / gate / provider so that
        Confirmation Gate events propagate through the active SSE stream and
        provider config is inherited (agent-design § 6.2 rules 4 + 7).
        """
        tool_registry = self._tools
        skill_registry = self._skills
        gate = self._gate
        employee_repo = self._employees

        def factory(child: Employee, depth: int) -> AgentRunner:
            # Sub-runner also gets a dispatch_service so nested dispatch works
            # until MAX_DISPATCH_DEPTH kicks in. Each sub-runner gets its own
            # throwaway SkillRuntime so resolve_skill calls inside the child's
            # task don't bleed into the parent's conversation state
            # (contract § 8.2 · isolation per runAgent iframe in V10).
            nested_factory = self._build_runner_factory(provider)
            nested_dispatch = DispatchService(
                employee_repo=employee_repo,
                runner_factory=nested_factory,
            )
            nested_spawn = SpawnSubagentService(
                employee_repo=employee_repo,
                runner_factory=nested_factory,
            )
            child_runtime = bootstrap_employee_runtime(child, skill_registry, tool_registry)
            return AgentRunner(
                employee=child,
                tool_registry=tool_registry,
                gate=gate,
                provider=provider,
                dispatch_service=nested_dispatch,
                skill_registry=skill_registry,
                runtime=child_runtime,
                spawn_subagent_service=nested_spawn,
                # Share the same checkpointer — child thread_ids are distinct
                # (allocated by dispatch/spawn call sites) so child graph state
                # lands in its own checkpoint family. ADR 0014 §3 Phase 1.
                checkpointer=self._checkpointer,
            )

        return factory

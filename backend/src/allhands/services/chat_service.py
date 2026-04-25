"""ChatService — the core use case: user sends a message, agent streams back."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from allhands.core import (
    Confirmation,
    ConfirmationStatus,
    Conversation,
    ConversationEvent,
    Employee,
    EventKind,
    Message,
    RenderPayload,
    ToolCall,
    ToolCallStatus,
    TurnAbortReason,
)
from allhands.core.errors import DomainError, EmployeeNotFound
from allhands.core.run_overrides import RunOverrides
from allhands.execution.dispatch import DispatchService
from allhands.execution.model_resolution import ResolvedModel, resolve_effective_model
from allhands.execution.runner import AgentRunner
from allhands.execution.skills import SkillRuntime, bootstrap_employee_runtime
from allhands.execution.tools.meta.spawn_subagent import SpawnSubagentService
from allhands.services.auto_compact import AutoCompactManager, CompactionConfig
from allhands.services.context_builder import build_llm_context
from allhands.services.turn_lock import TurnLockManager

log = logging.getLogger(__name__)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.execution.event_bus import EventBus
    from allhands.execution.events import AgentEvent
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.skills import SkillRegistry
    from allhands.persistence.repositories import (
        ConfirmationRepo,
        ConversationEventRepo,
        ConversationRepo,
        EmployeeRepo,
        LLMModelRepo,
        LLMProviderRepo,
        MCPServerRepo,
        SkillRuntimeRepo,
    )


DEFAULT_COMPACT_KEEP_LAST = 20
MIN_COMPACT_THRESHOLD = 4

# Cap the first-line snippet shown in the cockpit activity feed — the feed
# row is tight and a long reply would wrap into the next card.
_TURN_SUMMARY_MAX_CHARS = 80
_AUTO_TITLE_MAX_CHARS = 40


def _auto_title_from_user_content(content: str) -> str:
    """Pick a history-panel-friendly title from the user's first message.

    Strip wrapping whitespace, collapse the first non-empty line, and hard-cap
    at 40 characters with an ellipsis. Python 3 strings are unicode code
    points, so 40 points ≈ ~40 visible chars for CJK — UTF-8 safe.
    Zero-cost (no LLM round-trip), matching the ChatGPT / Claude sidebar
    baseline; explicit PATCH titles are preserved.
    """
    stripped = content.strip()
    first_line = next((line for line in stripped.splitlines() if line.strip()), stripped)
    collapsed = " ".join(first_line.split())
    if len(collapsed) <= _AUTO_TITLE_MAX_CHARS:
        return collapsed
    return collapsed[: _AUTO_TITLE_MAX_CHARS - 1].rstrip() + "…"


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
        model_repo: LLMModelRepo | None = None,
        bus: EventBus | None = None,
        skill_runtime_repo: SkillRuntimeRepo | None = None,
        mcp_repo: MCPServerRepo | None = None,
        checkpointer: Any | None = None,
        confirmation_repo: ConfirmationRepo | None = None,
        event_repo: ConversationEventRepo | None = None,
        plan_repo: Any = None,
        user_input_signal: Any = None,
    ) -> None:
        self._employees = employee_repo
        self._conversations = conversation_repo
        self._tools = tool_registry
        self._skills = skill_registry
        self._gate = gate
        self._providers = provider_repo
        # Registered models per provider — used by ``resolve_effective_model``
        # to validate that ``conversation.model_ref_override`` /
        # ``employee.model_ref`` actually point at a configured binding before
        # honouring them. Optional for legacy test constructions; when None
        # the resolver treats the model registry as empty (pass-through).
        self._models = model_repo
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
        # ADR 0018 · checkpointer kwarg accepted for backward compat with
        # callers that still pass it; the value is unused. State lives in
        # MessageRepo + ConfirmationRepo + SkillRuntimeRepo. B6 follow-up
        # removes this kwarg from the signature entirely.
        self._checkpointer = None
        del checkpointer
        # ADR 0014 Phase 4c/4d · When the runner pauses at an interrupt, the
        # tap in _persist_assistant_reply writes a PENDING Confirmation row so
        # /confirmations/pending can see it and the frontend's dialog has a
        # persistent handle. None in unit tests that don't exercise the gate
        # flow; optional keeps those tests unchanged.
        self._confirmation_repo = confirmation_repo
        # ADR 0019 C1 · per-conversation plan persistence. Optional so
        # legacy test constructions (no plan tools exercised) keep working.
        self._plan_repo = plan_repo
        # ADR 0019 C3 · clarification signal forwarded to AgentRunner
        # so ask_user_question tool defers via the polling UserInputDeferred.
        self._user_input_signal = user_input_signal
        # ADR 0017 · append-only event log. The authoritative SoT for
        # conversation history; ``messages`` table becomes a projection
        # cache. None keeps pre-ADR-0017 tests compiling — when unset the
        # service falls back to MessageRepo-driven context (old path).
        self._event_repo = event_repo
        # ADR 0017 · P2.A — per-conversation turn lock + supersede handling.
        # Shared across all send_message calls so two concurrent users on
        # the same conversation serialize through one lock and the late
        # writer writes TURN_ABORTED for whatever was in flight.
        self._turn_lock = TurnLockManager()
        # ADR 0017 · P2.B — auto-compaction manager. Per-process state
        # holds the circuit breaker counters; call maybe_compact before
        # build_llm_context so long conversations stay within the model's
        # context window.
        self._auto_compact = AutoCompactManager(config=CompactionConfig())

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

    async def resolve_model_for_conversation(
        self,
        conv: Conversation,
        employee: Employee,
    ) -> ResolvedModel | None:
        """Three-stage (override → employee → workspace default) resolution.

        Returns ``None`` only when ``provider_repo`` is unwired (legacy tests);
        callers fall back to whatever pre-existing handling they had. In
        production the chat router always wires a provider repo, so the
        ``None`` branch never fires.
        """
        if self._providers is None:
            return None
        providers = await self._providers.list_all()
        models = await self._models.list_all() if self._models is not None else []
        return resolve_effective_model(
            conv_override=conv.model_ref_override,
            employee_ref=employee.model_ref,
            providers=providers,
            models=models,
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

    async def _has_checkpoint_state(self, conversation_id: str) -> bool:
        """ADR 0018: checkpointer removed. Always returns False so the
        caller falls back to bootstrap (full MessageRepo history). The
        method shape is preserved for callsite compatibility through
        B6 — the next docs commit deletes it entirely.
        """
        _ = conversation_id  # kwarg preserved for backward compat
        return False

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

        # ADR 0017 · also write the USER event to the event log when wired.
        # The Message row stays as a projection cache for the frontend
        # /messages API; the event log is the authoritative source we read
        # from in build_llm_context below.
        #
        # Plan §1 (P2.A) · Turn lifecycle:
        # - If a turn is already in flight on this conversation, supersede
        #   it by writing TURN_ABORTED(user_superseded) and cancelling the
        #   prior task. The synthetic assistant message emitted by
        #   build_llm_context then tells the model it was interrupted.
        # - Write TURN_STARTED so orphan-scan at restart can detect crashes.
        active_turn = None
        if self._event_repo is not None:
            async with self._turn_lock.conversation_lock(conversation_id):
                await self._turn_lock.supersede_if_active(self._event_repo, conversation_id)
                await self._event_repo.append(
                    ConversationEvent(
                        id=user_msg.id,  # same id so projection ↔ event align
                        conversation_id=conversation_id,
                        parent_id=None,
                        sequence=await self._event_repo.next_sequence(conversation_id),
                        kind=EventKind.USER,
                        content_json={"content": user_content, "run_id": run_id},
                        created_at=run_started_at,
                    )
                )
                active_turn = self._turn_lock.start_turn(conversation_id, run_id=run_id)
                await self._event_repo.append(
                    ConversationEvent(
                        id=str(uuid.uuid4()),
                        conversation_id=conversation_id,
                        parent_id=None,
                        sequence=await self._event_repo.next_sequence(conversation_id),
                        kind=EventKind.TURN_STARTED,
                        content_json={
                            "turn_id": active_turn.turn_id,
                            "run_id": run_id,
                        },
                        turn_id=active_turn.turn_id,
                        created_at=datetime.now(UTC),
                    )
                )

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

        # ADR 0017 · the event log is the authoritative SoT; every turn
        # rebuilds the LLM input from scratch via the pure
        # ``build_llm_context`` projection (Claude Code
        # ``normalizeMessagesForAPI`` equivalent). Full history every
        # turn — no delta-send, no ``_has_checkpoint_state`` probe. The
        # runner then sends the full list to the provider and lets
        # prompt caching (P3.C) handle efficiency.
        #
        # Fallback (``event_repo is None``, legacy tests): read the
        # MessageRepo directly. This path is removed when P1.E completes
        # the migration.
        # Three-stage model resolution (override → employee → workspace
        # default). The previous code path silently fell back to
        # ``provider.default_model`` inside ``llm_factory`` when employee's
        # ``model_ref`` pointed at a provider that wasn't actually configured
        # (e.g. employee says ``openai/gpt-4o-mini`` while only CODINGPLAN is
        # registered). We now pre-validate against the provider+model registry
        # and surface the truthful binding to both the runner and the UI chip.
        resolved = await self.resolve_model_for_conversation(conv, employee)
        provider = resolved.provider if resolved is not None else None
        effective_model_ref = resolved.ref if resolved is not None else conv.model_ref_override

        if self._event_repo is not None:
            # P2.B · auto-compact before projecting the context. If the
            # event log has crossed the trigger threshold, the manager
            # calls the summarizer (a small LLM turn), writes a SUMMARY
            # event, and marks the oldest events compacted. Original
            # events are never deleted — projection / audit / branch all
            # still work.
            try:
                await self._auto_compact.maybe_compact(
                    conversation_id,
                    self._event_repo,
                    self._build_summarizer(provider, employee),
                )
            except Exception:
                log.exception(
                    "auto_compact.failed",
                    extra={"conversation_id": conversation_id},
                )

            _, lc_messages = await build_llm_context(
                conversation_id,
                employee,
                runtime,
                self._event_repo,
                skill_registry=self._skills,
                system_override=overrides.system_override if overrides else None,
            )
        else:
            history = await self._conversations.list_messages(conversation_id)
            lc_messages = [
                {"role": m.role, "content": m.content, "id": m.id}
                for m in history
                if m.role in ("user", "assistant")
            ]

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
            model_ref_override=effective_model_ref,
            plan_repo=self._plan_repo,
            conversation_id=conversation_id,
            user_input_signal=self._user_input_signal,
        )
        # ADR 0017 · per-turn thread_id. Claude Code invariant (V02 § 1.3):
        # each query() gets a fresh in-memory messages array; there's no
        # cross-query state leak. Our equivalent: fresh LangGraph thread_id
        # per turn. Reason: LangGraph's AsyncSqliteSaver persists graph
        # state under thread_id; sharing it across turns means a crashed
        # tool_use (no matching tool_result) leaves a zombie AIMessage in
        # state that poisons the next turn's validation ("AIMessage with
        # tool_calls has no corresponding ToolMessage"). By scoping state
        # to the turn, zombies die with the turn that created them.
        # Interrupt within a turn still works (same thread). Resume is
        # handled in resume_message which looks up the specific turn_id.
        thread_id = active_turn.turn_id if active_turn is not None else conversation_id
        return self._persist_assistant_reply(
            conversation_id,
            runner.stream(
                messages=lc_messages,
                thread_id=thread_id,
                overrides=overrides,
            ),
            employee=employee,
            run_id=run_id,
            run_started_at=run_started_at,
            active_turn=active_turn,
        )

    async def resume_message(
        self,
        conversation_id: str,
        resume_value: object,
    ) -> AsyncIterator[AgentEvent]:
        """ADR 0018 resume protocol · flip the latest pending Confirmation
        row · the in-flight /messages SSE's polling DeferredSignal sees
        the new status on its next tick and unblocks naturally.

        The frontend's POST to /resume opens a second short-lived SSE that
        immediately closes (DoneEvent). The real continuation of the turn
        keeps streaming through the original /messages SSE — no
        reconstruction, no graph replay.

        Body of work for this method is therefore tiny:
          1. Validate conversation exists.
          2. Find the latest PENDING Confirmation for the conversation
             (or the most recent one referenced by the unresolved
             INTERRUPT_RAISED event log entry).
          3. Translate resume_value into a ConfirmationStatus and persist.
          4. Yield a single DoneEvent so the SSE response closes cleanly.
        """
        from allhands.core import ConfirmationStatus
        from allhands.execution.events import DoneEvent

        conv = await self._conversations.get(conversation_id)
        if conv is None:
            raise DomainError(f"Conversation {conversation_id!r} not found.")
        # Employee lookup kept for parity with prior contract (callers may
        # rely on existence check side effects — e.g. permission audits).
        employee = await self._employees.get(conv.employee_id)
        if employee is None:
            raise EmployeeNotFound(f"Employee {conv.employee_id!r} not found.")

        # Map resume_value → ConfirmationStatus
        normalized = resume_value.strip().lower() if isinstance(resume_value, str) else ""
        if normalized in ("approve", "approved"):
            new_status = ConfirmationStatus.APPROVED
        elif normalized in ("reject", "rejected"):
            new_status = ConfirmationStatus.REJECTED
        else:
            new_status = ConfirmationStatus.EXPIRED

        # Find the pending confirmation. Heuristic: any row with status
        # == PENDING that's tied to this conversation. If multiple, the
        # most recent wins. Without a confirmation_repo wired we silently
        # no-op — that's the legacy unit-test path.
        target: Confirmation | None = None
        if self._confirmation_repo is not None:
            try:
                pending = await self._confirmation_repo.list_pending()
                # Filter to rows whose tool_call_id was emitted by this
                # conversation. We don't have a direct conversation_id
                # foreign key on Confirmation, so we fall back to "the
                # most recent pending row globally" — fine in practice
                # because there's typically one pending dialog per user.
                if pending:
                    target = sorted(pending, key=lambda c: c.created_at)[-1]
            except Exception:
                log.exception(
                    "resume_message.confirmation_lookup.failed",
                    extra={"conversation_id": conversation_id},
                )

        if target is not None:
            try:
                await self._confirmation_repo.update_status(target.id, new_status)  # type: ignore[union-attr]
            except Exception:
                log.exception(
                    "resume_message.confirmation_update.failed",
                    extra={"conversation_id": conversation_id, "confirmation_id": target.id},
                )

        # Yield a single DoneEvent so the HTTP client's SSE for /resume
        # closes cleanly. The actual turn continuation streams through
        # the original /messages SSE that's still open.
        async def _stream() -> AsyncIterator[AgentEvent]:
            yield DoneEvent(message_id=f"resume-{uuid.uuid4().hex[:8]}", reason="done")

        return _stream()

    async def _persist_assistant_reply(
        self,
        conversation_id: str,
        stream: AsyncIterator[AgentEvent],
        *,
        employee: Employee | None = None,
        run_id: str | None = None,
        run_started_at: datetime | None = None,
        active_turn: Any = None,
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
            # ADR 0017 · also write the ASSISTANT event. We embed tool_calls
            # and render_payloads into content_json so the event row is a
            # self-contained snapshot — the Message table stays as the
            # projection cache; projections like /messages stay cheap.
            if self._event_repo is not None:
                try:
                    await self._event_repo.append(
                        ConversationEvent(
                            id=message_id,
                            conversation_id=conversation_id,
                            parent_id=None,
                            sequence=await self._event_repo.next_sequence(conversation_id),
                            kind=EventKind.ASSISTANT,
                            content_json={
                                "content": content,
                                "reasoning": reasoning_text,
                                "tool_calls": [tc.model_dump() for tc in tool_calls_by_id.values()],
                                "render_payloads": [rp.model_dump() for rp in render_payloads],
                                "run_id": run_id,
                            },
                            created_at=first_seen or datetime.now(UTC),
                        )
                    )
                except Exception:
                    log.exception(
                        "Failed to persist ASSISTANT event",
                        extra={
                            "conversation_id": conversation_id,
                            "message_id": message_id,
                        },
                    )
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
                    # Track partial content on the active turn so a
                    # supersede / abort event carries what the model
                    # had already produced (debug / audit value).
                    if active_turn is not None:
                        active_turn.partial_content.append(event.delta)
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
                    # ADR 0017 · P2.C — fine-grained tool events. Write a
                    # TOOL_CALL_EXECUTED (or _FAILED) event so
                    # build_llm_context can pair it with the assistant's
                    # tool_use block on the next turn. The assistant event
                    # itself still carries the tool_use in content_blocks.
                    if self._event_repo is not None and active_turn is not None:
                        try:
                            failed = tc.status == ToolCallStatus.FAILED
                            kind_to_write = (
                                EventKind.TOOL_CALL_FAILED
                                if failed
                                else EventKind.TOOL_CALL_EXECUTED
                            )
                            result_body: dict[str, object] = {
                                "tool_use_id": tc.id,
                                "tool_call_id": tc.id,
                                "tool_id": tc.tool_id,
                            }
                            if failed:
                                result_body["error"] = tc.error or "tool failed"
                            else:
                                result_body["content"] = tc.result
                            await self._event_repo.append(
                                ConversationEvent(
                                    id=str(uuid.uuid4()),
                                    conversation_id=conversation_id,
                                    parent_id=None,
                                    sequence=await self._event_repo.next_sequence(conversation_id),
                                    kind=kind_to_write,
                                    content_json=result_body,
                                    turn_id=active_turn.turn_id,
                                    created_at=datetime.now(UTC),
                                )
                            )
                        except Exception:
                            log.exception(
                                "tool_call_event.append.failed",
                                extra={
                                    "conversation_id": conversation_id,
                                    "tool_call_id": tc.id,
                                },
                            )
                elif event.kind == "interrupt_required":
                    # ADR 0014 Phase 4d · write a PENDING Confirmation row
                    # so /confirmations/pending can see what's waiting and
                    # /confirmations/{id}/resolve has a handle. Keyed on
                    # LangGraph's interrupt_id which is stable across the
                    # pause — the frontend gets that id in the CUSTOM event
                    # and echoes it back as the confirmation_id.
                    if self._confirmation_repo is not None:
                        await self._write_pending_confirmation(event)
                elif event.kind == "error":
                    error_payload = {"code": event.code, "message": event.message}
                    await flush()
                    # ADR 0017 · surface stream errors as TURN_ABORTED so
                    # the next build_llm_context projects a synthetic
                    # assistant message explaining the gap.
                    if self._event_repo is not None:
                        try:
                            await self._event_repo.append(
                                ConversationEvent(
                                    id=str(uuid.uuid4()),
                                    conversation_id=conversation_id,
                                    parent_id=None,
                                    sequence=await self._event_repo.next_sequence(conversation_id),
                                    kind=EventKind.TURN_ABORTED,
                                    content_json={
                                        "reason": TurnAbortReason.STREAM_ERROR.value,
                                        "error_code": event.code,
                                        "error_message": event.message,
                                        "partial_content": "".join(buffer),
                                        "run_id": run_id,
                                    },
                                    created_at=datetime.now(UTC),
                                )
                            )
                        except Exception:
                            log.exception(
                                "Failed to persist TURN_ABORTED event",
                                extra={"conversation_id": conversation_id},
                            )
                elif event.kind == "done":
                    await flush()
                yield event
        finally:
            await flush()
            # P2.A · close the active turn in the event log. Complete path
            # if we have a flushed assistant reply and no error_payload;
            # abort path (stream_error) if there was an error or the stream
            # ended without producing any content (client disconnect case).
            if active_turn is not None and self._event_repo is not None:
                try:
                    if error_payload is not None:
                        # TURN_ABORTED already written by the error branch
                        # above; skip the duplicate here.
                        self._turn_lock.clear(conversation_id)
                    elif persisted:
                        await self._turn_lock.complete_turn(
                            self._event_repo, conversation_id, active_turn
                        )
                    else:
                        await self._turn_lock.abort_turn(
                            self._event_repo,
                            conversation_id,
                            active_turn,
                            reason=TurnAbortReason.CLIENT_DISCONNECT,
                        )
                except Exception:
                    log.exception(
                        "turn_lock.close.failed",
                        extra={"conversation_id": conversation_id},
                    )
            await finalize_run()
            # ADR 0011 · principle 7: flush any resolve_skill mutations made
            # during this turn so a uvicorn reload doesn't wipe them. Runs
            # after finalize_run so the cockpit event doesn't block on a DB
            # round-trip, and after flush() so the assistant message is
            # durable first (if this errors, at least the reply is saved).
            await self._flush_runtime(conversation_id)

    async def _write_pending_confirmation(self, event: Any) -> None:
        """Persist a Confirmation row on InterruptEvent (ADR 0014 Phase 4d).

        Called from the ``_persist_assistant_reply`` tap exactly once per
        pause (the runner's re-execution on resume produces no new
        InterruptEvent — LangGraph auto-matches). Keyed on the LangGraph
        interrupt id so /confirmations/{id}/resolve and the frontend dialog
        agree on the handle.

        Failure is swallowed on purpose — the graph has already paused and
        the UI has already rendered the dialog from the CUSTOM event; the
        DB row is a secondary concern for the pending-list endpoint. A
        hard throw here would kill the SSE + lose graph state.
        """
        if self._confirmation_repo is None:
            return
        try:
            value = event.value if isinstance(event.value, dict) else {}
            tool_call_id = str(value.get("tool_call_id", "") or "")
            summary = str(value.get("summary", "") or "")
            rationale = str(value.get("rationale", "") or "")
            diff_raw = value.get("diff")
            diff: dict[str, object] | None = dict(diff_raw) if isinstance(diff_raw, dict) else None
            now = datetime.now(UTC)
            confirmation = Confirmation(
                id=str(event.interrupt_id) or f"itr_{uuid.uuid4().hex[:16]}",
                tool_call_id=tool_call_id,
                rationale=rationale,
                summary=summary,
                diff=diff,
                status=ConfirmationStatus.PENDING,
                created_at=now,
                expires_at=now + timedelta(seconds=300),
            )
            await self._confirmation_repo.save(confirmation)
        except Exception:
            log.exception(
                "interrupt.confirmation.save.failed",
                extra={"interrupt_id": getattr(event, "interrupt_id", None)},
            )

    def _build_summarizer(self, provider: Any, employee: Employee) -> Any:
        """Build a callable that takes a list of {role, content} dicts and
        returns a compressed summary string. Used by auto-compact (P2.B).

        Uses the same LLM the conversation is already using — keeps
        provider / API key / base_url plumbing consistent. The call is a
        short one-shot: system prompt instructs brevity, payload is the
        events being compacted.
        """
        from allhands.execution.runner import _build_model

        async def _summarize(messages: list[dict[str, Any]]) -> str:
            model = _build_model(employee.model_ref, provider)
            from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

            system = SystemMessage(
                content=(
                    "You compress conversation histories. Summarize the "
                    "following exchange in 3-6 sentences, preserving any "
                    "decisions made, open questions, and key facts. Output "
                    "only the summary text — no preamble, no markdown."
                )
            )
            lc_msgs: list[Any] = [system]
            for m in messages:
                role = m.get("role")
                content = m.get("content", "")
                if role == "user":
                    lc_msgs.append(HumanMessage(content=content))
                elif role == "assistant":
                    lc_msgs.append(AIMessage(content=content))
            # .ainvoke returns a BaseMessage; its .content is the text we want.
            response = await model.ainvoke(lc_msgs)
            content = getattr(response, "content", "")
            if isinstance(content, list):
                # Some providers return structured blocks — flatten text ones.
                content = " ".join(
                    b.get("text", "")
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            return str(content or "").strip()

        return _summarize

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
                # ADR 0019 · plan_repo also shared with subagents so a Lead
                # → child dispatch can update the same plan. conversation_id
                # is None at the nested factory layer; the dispatch / spawn
                # service knows the conversation it's targeting and can
                # supply it through the runner kwargs path if needed.
                plan_repo=self._plan_repo,
                user_input_signal=self._user_input_signal,
            )

        return factory

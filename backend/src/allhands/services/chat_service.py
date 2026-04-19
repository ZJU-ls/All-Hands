"""ChatService — the core use case: user sends a message, agent streams back."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core import Conversation, Employee, Message
from allhands.core.errors import DomainError, EmployeeNotFound
from allhands.execution.dispatch import DispatchService
from allhands.execution.runner import AgentRunner
from allhands.execution.skills import SkillRuntime, bootstrap_employee_runtime

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.execution.events import AgentEvent
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.skills import SkillRegistry
    from allhands.persistence.repositories import ConversationRepo, EmployeeRepo, LLMProviderRepo


class ChatService:
    def __init__(
        self,
        employee_repo: EmployeeRepo,
        conversation_repo: ConversationRepo,
        tool_registry: ToolRegistry,
        skill_registry: SkillRegistry,
        gate: BaseGate,
        provider_repo: LLMProviderRepo | None = None,
    ) -> None:
        self._employees = employee_repo
        self._conversations = conversation_repo
        self._tools = tool_registry
        self._skills = skill_registry
        self._gate = gate
        self._providers = provider_repo
        # Per-conversation runtime · persists resolve_skill mutations across
        # send_message calls (contract § 8.2 · V02 query() main loop carries
        # the live tool pool turn-to-turn).
        self._runtime_cache: dict[str, SkillRuntime] = {}

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
    ) -> AsyncIterator[AgentEvent]:
        conv = await self._conversations.get(conversation_id)
        if conv is None:
            raise DomainError(f"Conversation {conversation_id!r} not found.")

        employee = await self._employees.get(conv.employee_id)
        if employee is None:
            raise EmployeeNotFound(f"Employee {conv.employee_id!r} not found.")

        user_msg = Message(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            role="user",
            content=user_content,
            created_at=datetime.now(UTC),
        )
        await self._conversations.append_message(user_msg)

        runtime = self._runtime_cache.get(conversation_id)
        if runtime is None:
            runtime = bootstrap_employee_runtime(employee, self._skills, self._tools)
            self._runtime_cache[conversation_id] = runtime

        history = await self._conversations.list_messages(conversation_id)
        lc_messages: list[dict[str, Any]] = [
            {"role": m.role, "content": m.content}
            for m in history
            if m.role in ("user", "assistant")
        ]

        provider = None
        if self._providers is not None:
            provider = await self._providers.get_default()

        dispatch_service = DispatchService(
            employee_repo=self._employees,
            runner_factory=self._build_runner_factory(provider),
        )
        runner = AgentRunner(
            employee=employee,
            tool_registry=self._tools,
            gate=self._gate,
            provider=provider,
            dispatch_service=dispatch_service,
            skill_registry=self._skills,
            runtime=runtime,
        )
        return runner.stream(messages=lc_messages, thread_id=conversation_id)

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
            nested_dispatch = DispatchService(
                employee_repo=employee_repo,
                runner_factory=self._build_runner_factory(provider),
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
            )

        return factory

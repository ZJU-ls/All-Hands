"""Real executors for Agent-managed READ meta tools (E21).

**Bug context:** before this module, every meta tool registered via
``discover_builtin_tools`` was bound to ``_async_noop`` (returns ``{}``).
The Lead Agent would dutifully call ``list_providers`` / ``list_skills`` etc.
— the discovery protocol in the prompt was working — but the tools
themselves returned nothing, so Lead reported "0 of each" and the user
(rightly) thought the prompt was ignored. Root cause is documented in
[error-patterns.md § E21](../../../../../docs/claude/error-patterns.md) and
[learnings.md § L12](../../../../../docs/claude/learnings.md).

**This module** gives each READ-scope meta tool a real executor. Each
executor is a closure over the async session_maker; it opens a fresh
session per invocation, uses the canonical service / repo layer, and
returns a JSON-safe ``dict`` (not a Pydantic model) because LangChain's
``StructuredTool`` needs pure JSON for the tool-result frame.

**Scope:** we only wire list_* / get_* READ tools here. Write-scope tools
(create / update / delete) stay no-op for now — they need the same
session-maker plumbing but have richer Confirmation-Gate semantics that
belong in a follow-up. The immediate user-visible damage is READ-side: if
Lead can't *see* the platform, Lead can't suggest the right action.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from allhands.persistence.sql_repos import (
    SqlEmployeeRepo,
    SqlLLMModelRepo,
    SqlLLMProviderRepo,
    SqlMCPServerRepo,
    SqlSkillRepo,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


_REDACT_KEYS = frozenset({"api_key", "secret_key", "admin_password", "password", "token"})


def _safe_dump(obj: Any) -> Any:
    """Pydantic → dict with secret-field redaction, fallback to str.

    Meta tool results land in the LLM's tool_result frame → provider → model
    context. Leaking an ``api_key`` into that stream means any subsequent
    assistant turn could echo it back to the user verbatim, or into a render
    tool payload. Redact every well-known secret key field to
    ``"***set***"`` (preserves the *has-a-value* signal the model needs to
    decide "can I use this provider?") without exposing the value itself.
    The REST gateway uses the same convention (``api_key_set: bool``) — this
    keeps parity so Lead sees the same shape tools and UI do.
    """
    if obj is None:
        return None
    if hasattr(obj, "model_dump"):
        data = obj.model_dump(mode="json")
    else:
        return str(obj)
    if isinstance(data, dict):
        return _redact(data)
    return data


def _redact(data: Any) -> Any:
    if isinstance(data, dict):
        return {
            k: ("***set***" if k in _REDACT_KEYS and v else _redact(v)) for k, v in data.items()
        }
    if isinstance(data, list):
        return [_redact(v) for v in data]
    return data


def _session_context(maker: async_sessionmaker[AsyncSession]) -> Any:
    """Context manager that opens a session + begins a transaction.

    Mirrors ``api/deps.get_session`` so READ tools get the same semantics
    (expire_on_commit=False · autoflush=False from the sessionmaker config).
    """
    session = maker()

    class _Ctx:
        async def __aenter__(self) -> AsyncSession:
            await session.__aenter__()
            # READ tools don't need an explicit transaction — but opening one
            # matches the FastAPI dep pattern and keeps aiosqlite happy.
            await session.begin()
            return session

        async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            if exc is None:
                await session.commit()
            else:
                await session.rollback()
            await session.__aexit__(exc_type, exc, tb)

    return _Ctx()


def make_list_providers_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlLLMProviderRepo(session).list_all()
        return {
            "providers": [_safe_dump(p) for p in rows],
            "count": len(rows),
        }

    return _exec


def make_get_provider_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(provider_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            p = await SqlLLMProviderRepo(session).get(provider_id)
        if p is None:
            return {"error": f"provider {provider_id!r} not found"}
        return {"provider": _safe_dump(p)}

    return _exec


def make_list_models_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlLLMModelRepo(session).list_all()
        return {
            "models": [_safe_dump(m) for m in rows],
            "count": len(rows),
        }

    return _exec


def make_get_model_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(model_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            m = await SqlLLMModelRepo(session).get(model_id)
        if m is None:
            return {"error": f"model {model_id!r} not found"}
        return {"model": _safe_dump(m)}

    return _exec


def make_list_skills_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlSkillRepo(session).list_all()
        return {
            "skills": [_safe_dump(s) for s in rows],
            "count": len(rows),
        }

    return _exec


def make_get_skill_detail_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(skill_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            s = await SqlSkillRepo(session).get(skill_id)
        if s is None:
            return {"error": f"skill {skill_id!r} not found"}
        return {"skill": _safe_dump(s)}

    return _exec


def make_list_mcp_servers_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlMCPServerRepo(session).list_all()
        return {
            "mcp_servers": [_safe_dump(m) for m in rows],
            "count": len(rows),
        }

    return _exec


def make_get_mcp_server_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(server_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            m = await SqlMCPServerRepo(session).get(server_id)
        if m is None:
            return {"error": f"mcp_server {server_id!r} not found"}
        return {"mcp_server": _safe_dump(m)}

    return _exec


def make_list_employees_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(status: str | None = None, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            rows = await SqlEmployeeRepo(session).list_all(status=status)
        # Trim the system_prompt on the list view — it's long and usually
        # not needed on discovery; Lead can call get_employee_detail for one.
        out: list[dict[str, Any]] = []
        for e in rows:
            d = _safe_dump(e)
            if isinstance(d, dict) and isinstance(d.get("system_prompt"), str):
                sp: str = d["system_prompt"]
                d["system_prompt"] = sp[:140] + ("…" if len(sp) > 140 else "")
            out.append(d)
        return {"employees": out, "count": len(rows)}

    return _exec


def make_get_employee_detail_executor(
    maker: async_sessionmaker[AsyncSession],
) -> ToolExecutor:
    async def _exec(
        employee_id: str | None = None, name: str | None = None, **_: Any
    ) -> dict[str, Any]:
        if not employee_id and not name:
            return {"error": "Provide employee_id or name."}
        async with _session_context(maker) as session:
            repo = SqlEmployeeRepo(session)
            e = None
            if employee_id:
                e = await repo.get(employee_id)
            if e is None and name:
                e = await repo.get_by_name(name)
        if e is None:
            return {"error": f"employee not found (id={employee_id!r} name={name!r})"}
        return {"employee": _safe_dump(e)}

    return _exec


# Tool-id → executor-factory map. Keys match the ``Tool.id`` strings in
# ``tools/meta/*.py``; values are callables that take a session_maker and
# return an executor. Resolved in ``tools/__init__.discover_builtin_tools``.
READ_META_EXECUTORS: dict[str, Callable[[async_sessionmaker[AsyncSession]], ToolExecutor]] = {
    "allhands.meta.list_providers": make_list_providers_executor,
    "allhands.meta.get_provider": make_get_provider_executor,
    "allhands.meta.list_models": make_list_models_executor,
    "allhands.meta.get_model": make_get_model_executor,
    "allhands.meta.list_skills": make_list_skills_executor,
    "allhands.meta.get_skill_detail": make_get_skill_detail_executor,
    "allhands.meta.list_mcp_servers": make_list_mcp_servers_executor,
    "allhands.meta.get_mcp_server": make_get_mcp_server_executor,
    "allhands.meta.list_employees": make_list_employees_executor,
    "allhands.meta.get_employee_detail": make_get_employee_detail_executor,
}

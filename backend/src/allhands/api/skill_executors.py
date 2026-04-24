"""Executor factories for Lead-Agent-driven skill management meta tools.

Lives in the ``api/`` layer because it closes over ``SkillService`` — which
belongs to ``services/``. The ``execution/`` layer is forbidden from
importing ``services/`` by the import-linter contract, so these executors
cannot live next to ``tools/meta/executors.py``.

``api.deps.get_tool_registry`` calls :func:`build_skill_management_executors`
once at startup and hands the resulting dict to
``discover_builtin_tools(..., extra_executors=...)``. At tool-call time each
executor opens a fresh session, constructs a ``SkillService``, and delegates.

Scope reminder: WRITE/IRREVERSIBLE tools (install/delete/update) are wrapped
by the :class:`ConfirmationGate` before the executor runs, so the agent
cannot bypass the user's confirmation.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from allhands.config import get_settings
from allhands.persistence.sql_repos import SqlSkillRepo
from allhands.services.github_market import (
    AnthropicsSkillsMarket,
    GithubMarketError,
    GithubSkillMarket,
)
from allhands.services.skill_service import SkillInstallError, SkillService

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


def _session_context(maker: async_sessionmaker[AsyncSession]) -> Any:
    """Open session + begin transaction (same shape as tools/meta/executors)."""
    session = maker()

    class _Ctx:
        async def __aenter__(self) -> AsyncSession:
            await session.__aenter__()
            await session.begin()
            return session

        async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            if exc is None:
                await session.commit()
            else:
                await session.rollback()
            await session.__aexit__(exc_type, exc, tb)

    return _Ctx()


def _safe_dump_skill(s: Any) -> dict[str, Any]:
    if hasattr(s, "model_dump"):
        data: dict[str, Any] = s.model_dump(mode="json")
        return data
    return {"repr": str(s)}


def _default_market() -> GithubSkillMarket:
    settings = get_settings()
    return AnthropicsSkillsMarket(
        owner=settings.skill_market_owner,
        repo=settings.skill_market_repo,
        branch=settings.skill_market_branch,
        path_prefix=settings.skill_market_path_prefix,
        cache_ttl_seconds=settings.skill_market_cache_ttl_seconds,
        token=settings.github_token,
    )


def build_skill_management_executors(
    maker: async_sessionmaker[AsyncSession],
    *,
    market: GithubSkillMarket | None = None,
) -> dict[str, ToolExecutor]:
    """Return a ``{tool_id: executor}`` mapping for all Lead-Agent-driven
    skill management meta tools. Injected into ``discover_builtin_tools``.

    The ``market`` argument is optional for tests; prod uses the default
    GitHub-backed client configured via ``Settings``.
    """
    resolved_market = market if market is not None else _default_market()

    def _service(session: AsyncSession) -> SkillService:
        settings = get_settings()
        return SkillService(
            repo=SqlSkillRepo(session),
            install_root=Path(settings.data_dir) / "skills",
            market=resolved_market,
        )

    async def list_skill_market(query: str | None = None, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                entries = await svc.list_market(query)
            except (SkillInstallError, GithubMarketError) as exc:
                return {"error": str(exc), "entries": [], "count": 0}
        return {
            "entries": [
                {
                    "slug": e.slug,
                    "name": e.name,
                    "description": e.description,
                    "version": e.version,
                    "source_url": e.source_url,
                    "tags": list(e.tags),
                }
                for e in entries
            ],
            "count": len(entries),
        }

    async def preview_skill_market(slug: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                p = await svc.preview_market_skill(slug)
            except SkillInstallError as exc:
                return {"error": str(exc)}
        return {
            "slug": p.slug,
            "name": p.name,
            "description": p.description,
            "version": p.version,
            "source_url": p.source_url,
            "skill_md": p.skill_md,
            "files": list(p.files),
        }

    async def install_skill_from_github(url: str, ref: str = "main", **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                installed = await svc.install_from_github(url, ref=ref)
            except SkillInstallError as exc:
                return {"error": str(exc)}
        return {
            "skills": [_safe_dump_skill(s) for s in installed],
            "count": len(installed),
        }

    async def install_skill_from_market(slug: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                skill = await svc.install_from_market(slug)
            except SkillInstallError as exc:
                return {"error": str(exc)}
        return {"skill": _safe_dump_skill(skill)}

    async def update_skill(
        skill_id: str,
        description: str | None = None,
        prompt_fragment: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            updated = await svc.update(
                skill_id,
                description=description,
                prompt_fragment=prompt_fragment,
            )
        if updated is None:
            return {"error": f"skill {skill_id!r} not found"}
        return {"skill": _safe_dump_skill(updated)}

    async def delete_skill(skill_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            await svc.delete(skill_id)
        return {"skill_id": skill_id, "deleted": True}

    return {
        "allhands.meta.list_skill_market": list_skill_market,
        "allhands.meta.preview_skill_market": preview_skill_market,
        "allhands.meta.install_skill_from_github": install_skill_from_github,
        "allhands.meta.install_skill_from_market": install_skill_from_market,
        "allhands.meta.update_skill": update_skill,
        "allhands.meta.delete_skill": delete_skill,
    }

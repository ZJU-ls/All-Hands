"""Executor factories for Gateway (provider + model) write meta tools.

These tools were declared in ``execution/tools/meta/{model,provider}_tools.py``
but never had executors wired — they fell through ``discover_builtin_tools``'s
``_async_noop`` and silently returned ``{}``. Symptom from the field
(2026-05-05): Lead Agent calls ``create_model(...)`` repeatedly, sees ``ok``
in the trace, but ``list_models`` never shows the new row.

Lives in ``api/`` because the executors close over LLMModelService /
LLMProviderService (services/) — execution/ is forbidden from importing
services/ by the import-linter contract.

Wired via ``discover_builtin_tools(extra_executors=...)`` in ``api/deps.py``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from allhands.persistence.sql_repos import SqlLLMModelRepo, SqlLLMProviderRepo
from allhands.services.connectivity import probe_endpoint, to_legacy_shape
from allhands.services.model_service import (
    LLMModelService,
    ModelConfigError,
    run_chat_test,
)
from allhands.services.provider_service import LLMProviderService

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


def _session_context(maker: async_sessionmaker[AsyncSession]) -> Any:
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


def _dump(obj: Any) -> dict[str, Any]:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")  # type: ignore[no-any-return]
    if isinstance(obj, dict):
        return obj
    return {"repr": str(obj)}


def _err(message: str, **fields: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"error": message}
    for k, v in fields.items():
        if v is not None:
            out[k] = v
    return out


def build_gateway_executors(
    maker: async_sessionmaker[AsyncSession],
) -> dict[str, ToolExecutor]:
    """Return executor mapping for every model + provider write meta tool.

    Read tools (list/get) are already wired through READ_META_EXECUTORS in
    execution/tools/meta/executors.py — we only fill the write surface here.
    """

    def _model_service(session: AsyncSession) -> LLMModelService:
        return LLMModelService(SqlLLMModelRepo(session), SqlLLMProviderRepo(session))

    def _provider_service(session: AsyncSession) -> LLMProviderService:
        return LLMProviderService(SqlLLMProviderRepo(session))

    # ─────────────────────────────────────────────────────────────
    # Model write tools
    # ─────────────────────────────────────────────────────────────

    async def create_model(
        provider_id: str,
        name: str,
        display_name: str = "",
        context_window: int = 0,
        max_input_tokens: int | None = None,
        max_output_tokens: int | None = None,
        supports_images: bool | None = None,
        capabilities: list[str] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _model_service(session)
            try:
                model = await svc.create(
                    provider_id=provider_id,
                    name=name,
                    display_name=display_name,
                    context_window=context_window,
                    max_input_tokens=max_input_tokens,
                    max_output_tokens=max_output_tokens,
                    supports_images=supports_images,
                    capabilities=capabilities,
                )
            except ModelConfigError as exc:
                return _err(str(exc), field="payload", hint="see error for the offending field")
        if model is None:
            return _err(
                f"provider {provider_id!r} not found",
                field="provider_id",
                hint="call list_providers to see configured ids",
            )
        return {"model": _dump(model)}

    async def update_model(
        model_id: str,
        name: str | None = None,
        display_name: str | None = None,
        context_window: int | None = None,
        max_input_tokens: int | None = None,
        max_output_tokens: int | None = None,
        enabled: bool | None = None,
        supports_images: bool | None = None,
        capabilities: list[str] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _model_service(session)
            try:
                model = await svc.update(
                    model_id,
                    name=name,
                    display_name=display_name,
                    context_window=context_window,
                    max_input_tokens=max_input_tokens,
                    max_output_tokens=max_output_tokens,
                    enabled=enabled,
                    supports_images=supports_images,
                    capabilities=capabilities,
                )
            except ModelConfigError as exc:
                return _err(str(exc), field="payload")
        if model is None:
            return _err(f"model {model_id!r} not found", field="model_id")
        return {"model": _dump(model)}

    async def delete_model(model_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            await _model_service(session).delete(model_id)
        return {"model_id": model_id, "deleted": True}

    async def set_default_model(model_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _model_service(session)
            pair = await svc.set_as_default(model_id)
        if pair is None:
            return _err(f"model {model_id!r} not found", field="model_id")
        model, provider = pair
        return {
            "model": _dump(model),
            "provider_id": provider.id,
            "provider_name": provider.name,
        }

    async def ping_model(model_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _model_service(session)
            pair = await svc.resolve_with_provider(model_id)
        if pair is None:
            return _err(f"model {model_id!r} not found", field="model_id")
        model, provider = pair
        import httpx

        from allhands.services.connectivity import (
            ENDPOINT_TIMEOUT_S,
            MODEL_TIMEOUT_S,
            overall_status,
            probe_model,
        )

        async with httpx.AsyncClient(timeout=ENDPOINT_TIMEOUT_S) as ec:
            endpoint = await probe_endpoint(provider, http_client=ec)
        async with httpx.AsyncClient(timeout=MODEL_TIMEOUT_S) as mc:
            m_probe = await probe_model(provider, model.name, http_client=mc)
        status = overall_status(endpoint, m_probe)
        return to_legacy_shape(
            model_name=model.name, endpoint=endpoint, model=m_probe, status=status
        )

    async def chat_test_model(
        model_id: str,
        prompt: str = "ping",
        messages: list[dict[str, Any]] | None = None,
        system: str | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        max_tokens: int | None = None,
        stop: list[str] | None = None,
        enable_thinking: bool | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _model_service(session)
            pair = await svc.resolve_with_provider(model_id)
        if pair is None:
            return _err(f"model {model_id!r} not found", field="model_id")
        model, provider = pair
        return await run_chat_test(
            provider,
            model.name,
            prompt=prompt if not messages else None,
            messages=messages,
            system=system,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            stop=stop,
            enable_thinking=enable_thinking,
        )

    # ─────────────────────────────────────────────────────────────
    # Provider write tools
    # ─────────────────────────────────────────────────────────────

    async def create_provider(
        name: str,
        base_url: str,
        kind: str = "openai",
        api_key: str = "",
        **_: Any,
    ) -> dict[str, Any]:
        if kind not in ("openai", "anthropic", "aliyun"):
            return _err(
                f"unknown provider kind {kind!r}",
                field="kind",
                expected="openai | anthropic | aliyun",
                received=kind,
            )
        async with _session_context(maker) as session:
            svc = _provider_service(session)
            try:
                provider = await svc.create(
                    name=name,
                    kind=cast("Any", kind),
                    base_url=base_url,
                    api_key=api_key,
                )
            except ValueError as exc:
                return _err(str(exc), field="payload")
        return {"provider": _dump(provider)}

    async def update_provider(
        provider_id: str,
        name: str | None = None,
        kind: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        enabled: bool | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _provider_service(session)
            try:
                provider = await svc.update(
                    provider_id,
                    name=name,
                    kind=cast("Any", kind) if kind is not None else None,
                    base_url=base_url,
                    api_key=api_key,
                    enabled=enabled,
                )
            except ValueError as exc:
                return _err(str(exc), field="payload")
        if provider is None:
            return _err(f"provider {provider_id!r} not found", field="provider_id")
        return {"provider": _dump(provider)}

    async def delete_provider(provider_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            await _provider_service(session).delete(provider_id)
        return {"provider_id": provider_id, "deleted": True}

    async def list_provider_presets(**_: Any) -> dict[str, Any]:
        from allhands.core.provider_presets import PROVIDER_PRESETS

        return {
            "presets": [
                {
                    "kind": p.kind,
                    "label": p.label,
                    "base_url": p.base_url,
                    "default_model": p.default_model,
                }
                for p in PROVIDER_PRESETS.values()
            ]
        }

    async def test_provider_connection(provider_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _provider_service(session)
            provider = await svc.get(provider_id)
        if provider is None:
            return _err(f"provider {provider_id!r} not found", field="provider_id")
        import httpx

        from allhands.services.connectivity import ENDPOINT_TIMEOUT_S

        async with httpx.AsyncClient(timeout=ENDPOINT_TIMEOUT_S) as c:
            probe = await probe_endpoint(provider, http_client=c)
        return {
            "ok": probe.reachable and probe.auth_ok is not False,
            "endpoint": provider.base_url,
            "status": probe.status_code,
            "error": probe.error,
            "latency_ms": probe.latency_ms,
            "reachable": probe.reachable,
            "auth_ok": probe.auth_ok,
        }

    return {
        # Model writes
        "allhands.meta.create_model": create_model,
        "allhands.meta.update_model": update_model,
        "allhands.meta.delete_model": delete_model,
        "allhands.meta.set_default_model": set_default_model,
        "allhands.meta.ping_model": ping_model,
        "allhands.meta.chat_test_model": chat_test_model,
        # Provider writes
        "allhands.meta.create_provider": create_provider,
        "allhands.meta.update_provider": update_provider,
        "allhands.meta.delete_provider": delete_provider,
        "allhands.meta.list_provider_presets": list_provider_presets,
        "allhands.meta.test_provider_connection": test_provider_connection,
    }

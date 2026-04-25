"""Real executors for KB Meta Tools.

Each executor is a closure over a KnowledgeService instance. The api/
layer constructs the service at startup and passes
``kb_executors_for(service)`` into ``discover_builtin_tools(extra_executors=…)``.
This keeps the execution layer free of L6 service imports while still
giving Meta Tools real functionality.

Why we don't share a session_maker the way READ_META_EXECUTORS does:
KnowledgeService composes embedder + retriever + ingest, which are
expensive to rebuild per call. One service per process; many calls
share it.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from allhands.services.knowledge_service import KnowledgeService

ToolExecutor = Callable[..., Awaitable[Any]]


def kb_executors_for(svc: KnowledgeService) -> dict[str, ToolExecutor]:
    """Return a {tool_id: executor} map keyed by Meta Tool id."""

    async def _list(**_: Any) -> dict[str, Any]:
        kbs = await svc.list_kbs()
        return {
            "kbs": [
                {
                    "id": k.id,
                    "name": k.name,
                    "description": k.description,
                    "doc_count": k.document_count,
                    "chunk_count": k.chunk_count,
                    "embedding_model_ref": k.embedding_model_ref,
                    "embedding_dim": k.embedding_dim,
                    "visibility": k.visibility.value,
                    "updated_at": k.updated_at.isoformat(),
                }
                for k in kbs
            ]
        }

    async def _browse(
        kb_id: str,
        collection_id: str | None = None,
        title_prefix: str | None = None,
        tag: str | None = None,
        state: str | None = None,
        limit: int = 50,
        offset: int = 0,
        **_: Any,
    ) -> dict[str, Any]:
        from allhands.core import DocumentState

        docs = await svc.list_documents(
            kb_id,
            collection_id=collection_id,
            state=DocumentState(state) if state else None,
            title_prefix=title_prefix,
            tag=tag,
            limit=limit,
            offset=offset,
        )
        return {
            "documents": [
                {
                    "id": d.id,
                    "title": d.title,
                    "mime_type": d.mime_type,
                    "state": d.state.value,
                    "tags": list(d.tags),
                    "chunk_count": d.chunk_count,
                    "size_bytes": d.size_bytes,
                    "version": d.version,
                    "updated_at": d.updated_at.isoformat(),
                }
                for d in docs
            ]
        }

    async def _search(kb_id: str, query: str, top_k: int | None = None, **_: Any) -> dict[str, Any]:
        results = await svc.search(kb_id, query, top_k=top_k)
        return {
            "results": [
                {
                    "chunk_id": r.chunk.id,
                    "doc_id": r.chunk.document_id,
                    "score": round(r.score, 5),
                    "text": r.chunk.text,
                    "section_path": r.chunk.section_path,
                    "page": r.chunk.page,
                    "citation": r.citation,
                    "bm25_rank": r.bm25_rank,
                    "vector_rank": r.vector_rank,
                }
                for r in results
            ]
        }

    async def _read(document_id: str, max_chars: int = 20000, **_: Any) -> dict[str, Any]:
        text = await svc.read_document_text(document_id)
        truncated = len(text) > max_chars
        return {
            "document_id": document_id,
            "content": text[:max_chars],
            "truncated": truncated,
            "total_chars": len(text),
        }

    async def _create_document(
        kb_id: str,
        title: str,
        content: str,
        mime_type: str | None = None,
        tags: list[str] | None = None,
        # Confirmation pipeline injects these from the agent context:
        _employee_id: str | None = None,
        _skill_id: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        # Grant gate: agent path requires write grant; UI/REST path bypasses
        # by leaving employee_id None.
        if (_employee_id or _skill_id) and not await svc.has_write_grant(
            kb_id, employee_id=_employee_id, skill_id=_skill_id
        ):
            return {
                "error": "no_grant",
                "message": (
                    f"No WRITE grant for kb={kb_id!r} on this principal. Ask the user "
                    f"to call kb_grant_permission first, or perform the write via the UI."
                ),
            }
        doc = await svc.upload_document(
            kb_id,
            title=title,
            content_bytes=content.encode("utf-8"),
            filename=f"{title}.md",
            mime_type=mime_type or "text/markdown",
            tags=tags,
            source_type=__import__("allhands.core", fromlist=["SourceType"]).SourceType.AGENT
            if (_employee_id or _skill_id)
            else __import__("allhands.core", fromlist=["SourceType"]).SourceType.PASTE,
            created_by_employee_id=_employee_id,
        )
        return {
            "document_id": doc.id,
            "state": doc.state.value,
            "chunk_count": doc.chunk_count,
            "version": doc.version,
        }

    async def _grant(
        kb_id: str,
        scope: str,
        employee_id: str | None = None,
        skill_id: str | None = None,
        expires_at: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        from allhands.core import GrantScope

        exp_dt: datetime | None = None
        if expires_at:
            exp_dt = datetime.fromisoformat(expires_at)
        grant = await svc.grant_permission(
            kb_id,
            scope=GrantScope(scope),
            employee_id=employee_id,
            skill_id=skill_id,
            expires_at=exp_dt,
        )
        return {
            "grant_id": grant.id,
            "scope": grant.scope.value,
            "kb_id": grant.kb_id,
            "expires_at": grant.expires_at.isoformat() if grant.expires_at else None,
        }

    async def _set_cfg(kb_id: str, **kwargs: Any) -> dict[str, Any]:
        from allhands.core import RetrievalConfig

        kb = await svc.get_kb(kb_id)
        merged = kb.retrieval_config.model_dump()
        for k, v in kwargs.items():
            if k.startswith("_"):  # injected agent context
                continue
            if v is None:
                continue
            if k in merged:
                merged[k] = v
        new_cfg = RetrievalConfig.model_validate(merged)
        out = await svc.update_retrieval_config(kb_id, new_cfg)
        return {"kb_id": kb_id, "retrieval_config": out.retrieval_config.model_dump()}

    async def _list_models(**_: Any) -> dict[str, Any]:
        return {
            "models": [
                {
                    "ref": o.ref,
                    "label": o.label,
                    "dim": o.dim,
                    "available": o.available,
                    "reason": o.reason,
                    "is_default": o.is_default,
                }
                for o in svc.list_embedding_models()
            ]
        }

    return {
        "allhands.kb.list": _list,
        "allhands.kb.list_embedding_models": _list_models,
        "allhands.kb.browse_collection": _browse,
        "allhands.kb.search": _search,
        "allhands.kb.read_document": _read,
        "allhands.kb.create_document": _create_document,
        "allhands.kb.grant_permission": _grant,
        "allhands.kb.set_retrieval_config": _set_cfg,
    }


__all__ = ["kb_executors_for"]

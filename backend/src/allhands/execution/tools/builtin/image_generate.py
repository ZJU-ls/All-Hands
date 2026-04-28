"""Backend tool · generate_image · the LLM-facing wrapper around ImageProvider.

Lifecycle (decoupled · AgentLoop unchanged):

    LLM tool_call
       │
       ▼
    generate_image(prompts=[...], size, quality, model_ref?)
       │  per-prompt validation (ADR 0021 envelope on bad input)
       ▼
    ImageProvider.generate x N · asyncio.gather concurrent
       │  (FakeImageProvider in tests · OpenAIImageProvider in prod)
       ▼
    For each successful image → ArtifactService.create(kind=image)
       │  (the artifact storage system already supports image kind ·
       │   we don't reinvent storage · we just chain one tool to another)
       ▼
    Return [{artifact_id, url, prompt, mime_type, size}, ...]
       (markdown can ![](/api/artifacts/<id>/content) · pptx slides
        layout=image-right with image_url)

The tool is BACKEND scope=WRITE + requires_confirmation=True. Default
confirmation flow shows the budget chip ("about $0.16 for 4 images") so
the user can approve before paid generation fires. Confirmation can be
auto-approved by user via permissions.json once the workspace is trusted.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
from typing import Any, Protocol

from allhands.core import CostHint, Tool, ToolKind, ToolScope
from allhands.core.image import (
    ALLOWED_SIZES,
    MAX_BATCH,
    MAX_PROMPT_CHARS,
    MIN_PROMPT_CHARS,
    ImageGenerationRequest,
    ImageQuality,
    estimate_cost,
)
from allhands.execution.image_provider import (
    ImageProvider,
    ImageProviderError,
    OpenAIImageProvider,
)


class ArtifactStore(Protocol):
    """Minimal Protocol for the artifact persistence we need.

    Decouples this tool from `services/` (lint-imports forbids
    execution → services). The api layer wires the real ArtifactService
    via duck-typing — its `create()` already matches this shape, so no
    code change at the call site.
    """

    async def create(
        self,
        *,
        name: str,
        kind: object,
        content: str | None = None,
        content_base64: str | None = None,
        mime_type: str | None = None,
        workspace_id: str = ...,
        conversation_id: str | None = None,
        created_by_employee_id: str | None = None,
        created_by_run_id: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> Any: ...


TOOL = Tool(
    id="allhands.image.generate",
    kind=ToolKind.BACKEND,
    name="generate_image",
    description=(
        "Generate one or more images from text prompts via the configured "
        "image-generation model. Pass `prompts` as a list (1-10 items); they "
        "run concurrently. Each image is automatically saved as an artifact "
        "you can reference: in markdown via "
        "`![alt](/api/artifacts/<artifact_id>/content)`, or in pptx via "
        "`image_url` on an image-right layout. Returns "
        "`{images: [{artifact_id, url, prompt, mime_type, size}], total_cost_usd, "
        "duration_ms}`. For a 6-page PPT with one image per page, send all 6 "
        "prompts in one call so they run in parallel — far faster than "
        "sequential calls."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "prompts": {
                "type": "array",
                "items": {
                    "type": "string",
                    "minLength": MIN_PROMPT_CHARS,
                    "maxLength": MAX_PROMPT_CHARS,
                },
                "minItems": 1,
                "maxItems": MAX_BATCH,
                "description": "1-10 prompts · run concurrently.",
            },
            "size": {
                "type": "string",
                "enum": list(ALLOWED_SIZES),
                "default": "1024x1024",
            },
            "quality": {
                "type": "string",
                "enum": [q.value for q in ImageQuality],
                "default": "auto",
            },
            "model_ref": {
                "type": "string",
                "description": (
                    "Override: 'provider/model' · e.g. 'openai/gpt-image-1.5'. "
                    "Defaults to the workspace's configured image-capable model."
                ),
            },
        },
        "required": ["prompts"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "images": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "artifact_id": {"type": "string"},
                        "url": {"type": "string"},
                        "prompt": {"type": "string"},
                        "mime_type": {"type": "string"},
                        "size": {"type": "string"},
                        "revised_prompt": {"type": ["string", "null"]},
                        "error": {"type": "string"},
                    },
                },
            },
            "total_cost_usd": {"type": ["number", "null"]},
            "duration_ms": {"type": "integer"},
            "error": {"type": "string"},
            "field": {"type": "string"},
            "expected": {"type": "string"},
            "received": {"type": "string"},
            "hint": {"type": "string"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=True,
    cost_hint=CostHint(relative="medium"),
)


# Type alias for the per-image artifact creator: callers inject a closure
# bound to ArtifactService (and conversation_id / employee_id for trace).
ArtifactCreator = Callable[..., Any]  # async (name, content_base64, mime_type) -> Artifact


def make_executor(
    *,
    provider_factory: Callable[[str | None], ImageProvider],
    artifact_service: ArtifactStore,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    workspace_id: str = "default",
) -> Callable[..., Any]:
    """Build the executor closure · DI for tests + per-conversation binding.

    `provider_factory(model_ref)` returns a fresh ImageProvider for the given
    'provider/model' override (None ⇒ default). The factory layer (in
    api/deps.py) reads from LLMProviderRepo + LLMModelRepo + filters by
    Capability.IMAGE_GEN to pick a model.

    `artifact_service` is the existing ArtifactService — we just call its
    `create(kind="image", content_base64=...)` for each generated image. No
    new storage path; perfect symmetry with how a user uploads an image.
    """
    from allhands.core.artifact import ArtifactKind

    # ArtifactService.create writes via the bound session · concurrent adds on
    # the same session cause SQLAlchemy's "Session.add during flush" warning.
    # Image gen (the slow part) stays concurrent; only the storage step is
    # serialized via this lock — adds < 50 ms each, no perceptible impact.
    save_lock = asyncio.Lock()

    async def _execute(**kwargs: Any) -> dict[str, Any]:
        # ── 1. parse + validate input via pydantic-driven loop ──────────────
        prompts = kwargs.get("prompts")
        if not isinstance(prompts, list) or not prompts:
            return {
                "error": "prompts must be a non-empty list",
                "field": "prompts",
                "expected": "list[str] · length 1-10",
                "received": repr(prompts)[:120],
            }
        if len(prompts) > MAX_BATCH:
            return {
                "error": f"too many prompts · {len(prompts)} > {MAX_BATCH}",
                "field": "prompts",
                "expected": f"≤ {MAX_BATCH}",
                "hint": (
                    "Split into multiple generate_image calls; each call's "
                    "prompts run concurrently."
                ),
            }
        size = kwargs.get("size", "1024x1024")
        if size not in ALLOWED_SIZES:
            return {
                "error": f"unsupported size {size!r}",
                "field": "size",
                "expected": f"one of {list(ALLOWED_SIZES)}",
                "received": str(size),
            }
        try:
            quality = ImageQuality(kwargs.get("quality", "auto"))
        except ValueError:
            return {
                "error": f"unknown quality {kwargs.get('quality')!r}",
                "field": "quality",
                "expected": [q.value for q in ImageQuality],
            }
        model_ref = kwargs.get("model_ref")

        # ── 2. resolve provider ─────────────────────────────────────────────
        try:
            provider = provider_factory(model_ref)
        except ImageProviderError as exc:
            return exc.to_dict()
        except Exception as exc:
            return {
                "error": f"failed to build image provider: {exc.__class__.__name__}",
                "field": "model_ref",
                "received": str(model_ref) if model_ref else "(default)",
                "hint": (
                    "Ensure your provider has at least one model with "
                    "capabilities including 'image_gen'."
                ),
            }

        # ── 3. fan out · per-prompt request · gather ────────────────────────
        async def _one(prompt: str) -> dict[str, Any]:
            try:
                req = ImageGenerationRequest(prompt=prompt, size=size, quality=quality, n=1)
            except Exception as exc:
                return {"error": f"invalid prompt: {exc}", "prompt": prompt[:100]}
            try:
                result = await provider.generate(req)
            except ImageProviderError as exc:
                return {**exc.to_dict(), "prompt": prompt[:100]}
            # ── 4. each image → artifact_create(kind=image) ─────────────────
            artifacts_out: list[dict[str, Any]] = []
            for img in result.images:
                content_b64 = base64.b64encode(img.data).decode("ascii")
                artifact_name = _safe_artifact_name(prompt)
                try:
                    async with save_lock:
                        art = await artifact_service.create(
                            name=artifact_name,
                            kind=ArtifactKind.IMAGE,
                            content_base64=content_b64,
                            mime_type=img.mime_type,
                            workspace_id=workspace_id,
                            conversation_id=conversation_id,
                            created_by_employee_id=employee_id,
                            metadata={
                                "image_gen": True,
                                "model": result.model_used,
                                "provider": result.provider_id,
                                "prompt": img.prompt,
                                "revised_prompt": img.revised_prompt,
                                "size": img.size,
                            },
                        )
                except Exception as exc:
                    return {
                        "error": f"failed to save artifact: {exc.__class__.__name__}",
                        "prompt": prompt[:100],
                        "hint": "Check workspace_id and that artifact storage is healthy.",
                    }
                artifacts_out.append(
                    {
                        "artifact_id": art.id,
                        "url": f"/api/artifacts/{art.id}/content",
                        "prompt": prompt,
                        "mime_type": img.mime_type,
                        "size": img.size,
                        "revised_prompt": img.revised_prompt,
                    }
                )
            return {"images": artifacts_out, "duration_ms": result.duration_ms}

        per_prompt_results = await asyncio.gather(*(_one(p) for p in prompts))

        # ── 5. aggregate · keep partial successes intact ────────────────────
        flat_images: list[dict[str, Any]] = []
        total_duration = 0
        for res in per_prompt_results:
            if "images" in res:
                flat_images.extend(res["images"])
                total_duration = max(total_duration, res.get("duration_ms", 0))
            else:
                # An error envelope for this prompt — surface it inline so the
                # LLM can decide to retry just this one.
                flat_images.append({k: v for k, v in res.items() if k != "images"})

        # cost estimate (best-effort)
        # Pull model name off the provider for the estimator (Fake exposes 'fake-image-1')
        model_name = getattr(provider, "model_name", "")
        cost = estimate_cost(model_name=model_name, quality=quality, size=size, n=len(flat_images))

        return {
            "images": flat_images,
            "total_cost_usd": cost,
            "duration_ms": total_duration,
        }

    return _execute


# Default executor — unbound; the real one is built per-conversation in
# api/deps.py via make_executor(). The unbound version raises a helpful
# error so any accidental direct invocation fails loudly.


async def execute(**_: Any) -> dict[str, Any]:
    return {
        "error": "generate_image needs a per-conversation executor",
        "hint": (
            "This stub is registered for tool discovery only; the real executor "
            "is constructed in api/deps.py with the bound ArtifactService and "
            "provider_factory."
        ),
    }


def build_default_provider_factory(
    *,
    api_key: str,
    base_url: str,
    default_model: str,
    provider_id: str,
) -> Callable[[str | None], ImageProvider]:
    """Convenience · construct a provider_factory for OpenAI-compat endpoints.

    Most users just need this. Fancier setups (DashScope wanx / multi-provider
    routing) write their own factory and inject it.
    """

    def _factory(model_ref: str | None) -> ImageProvider:
        # model_ref override ⇒ split 'provider/model' if present
        model_name = default_model
        if model_ref and "/" in model_ref:
            model_name = model_ref.split("/", 1)[1]
        elif model_ref:
            model_name = model_ref
        return OpenAIImageProvider(
            api_key=api_key,
            base_url=base_url,
            model_name=model_name,
            provider_id=provider_id,
        )

    return _factory


__all__ = [
    "TOOL",
    "ArtifactCreator",
    "build_default_provider_factory",
    "execute",
    "make_executor",
    "make_gateway_executor",
]


_ARTIFACT_NAME_BAD = __import__("re").compile(r"[^\w一-龿\s._-]")


def _safe_artifact_name(prompt: str) -> str:
    """ArtifactService.create has a strict name regex (letters / digits / CJK
    / space / . _ -). Sanitize freeform prompts before naming."""
    cleaned = _ARTIFACT_NAME_BAD.sub("_", prompt[:32])
    return f"img-{cleaned.strip() or 'gen'}.png"


# ─────────────────────────────────────────────────────────────────────────
# Gateway-flavored executor · the new path (MODEL-GATEWAY.html § A4)
# ─────────────────────────────────────────────────────────────────────────


def make_gateway_executor(
    *,
    gateway: object,  # ModelGateway · forward-decl to avoid execution↔execution cycle on import
    resolve_provider_model: Callable[[str | None], tuple[object, object]],
    artifact_service: ArtifactStore,
    conversation_id: str | None = None,
    employee_id: str | None = None,
    workspace_id: str = "default",
) -> Callable[..., Any]:
    """Build the executor closure backed by ``ModelGateway``.

    Same I/O contract as ``make_executor`` (the legacy provider-based form);
    swaps the per-prompt provider call for a single gateway dispatch that
    routes to the right adapter (OpenAI / DashScope / Imagen / FLUX / ...).

    ``resolve_provider_model(model_ref)`` returns a (LLMProvider, LLMModel)
    pair. The api/deps.py wiring picks:
      - the model whose id matches model_ref, OR
      - the first enabled model with Capability.IMAGE_GEN.
    Errors bubble up as ImageProviderError so the LLM gets a real envelope.
    """
    from allhands.core.artifact import ArtifactKind

    save_lock = asyncio.Lock()

    async def _execute(**kwargs: Any) -> dict[str, Any]:
        # ── 1. parse + validate input ──────────────────────────────────────
        prompts = kwargs.get("prompts")
        if not isinstance(prompts, list) or not prompts:
            return {
                "error": "prompts must be a non-empty list",
                "field": "prompts",
                "expected": "list[str] · length 1-10",
                "received": repr(prompts)[:120],
            }
        if len(prompts) > MAX_BATCH:
            return {
                "error": f"too many prompts · {len(prompts)} > {MAX_BATCH}",
                "field": "prompts",
                "expected": f"≤ {MAX_BATCH}",
                "hint": "Split into multiple generate_image calls.",
            }
        size = kwargs.get("size", "1024x1024")
        if size not in ALLOWED_SIZES:
            return {
                "error": f"unsupported size {size!r}",
                "field": "size",
                "expected": f"one of {list(ALLOWED_SIZES)}",
                "received": str(size),
            }
        try:
            quality = ImageQuality(kwargs.get("quality", "auto"))
        except ValueError:
            return {
                "error": f"unknown quality {kwargs.get('quality')!r}",
                "field": "quality",
                "expected": [q.value for q in ImageQuality],
            }
        model_ref = kwargs.get("model_ref")

        # ── 2. resolve (provider, model) pair via injected resolver ────────
        try:
            provider, model = resolve_provider_model(model_ref)
        except ImageProviderError as exc:
            return exc.to_dict()
        except Exception as exc:
            # Surface gateway routing errors (NoAdapterFoundError) via duck-type
            to_dict = getattr(exc, "to_dict", None)
            if callable(to_dict):
                return to_dict()  # type: ignore[no-any-return]
            return {
                "error": f"failed to resolve image model: {exc.__class__.__name__}",
                "field": "model_ref",
                "received": str(model_ref) if model_ref else "(default)",
                "hint": (
                    "Register a model with capabilities including 'image_gen' "
                    "in /settings/providers."
                ),
            }

        # ── 3. fan out · per-prompt request · gather ───────────────────────
        async def _one(prompt: str) -> dict[str, Any]:
            try:
                req = ImageGenerationRequest(prompt=prompt, size=size, quality=quality, n=1)
            except Exception as exc:
                return {"error": f"invalid prompt: {exc}", "prompt": prompt[:100]}
            try:
                # Gateway dispatches to the right adapter based on
                # (modality, provider.kind, model.name).
                result = await gateway.generate_image(  # type: ignore[attr-defined]
                    req, provider=provider, model=model
                )
            except ImageProviderError as exc:
                return {**exc.to_dict(), "prompt": prompt[:100]}
            except Exception as exc:
                to_dict = getattr(exc, "to_dict", None)
                if callable(to_dict):
                    return {**to_dict(), "prompt": prompt[:100]}
                return {
                    "error": f"adapter failed: {exc.__class__.__name__}",
                    "prompt": prompt[:100],
                }

            artifacts_out: list[dict[str, Any]] = []
            for img in result.images:
                content_b64 = base64.b64encode(img.data).decode("ascii")
                artifact_name = _safe_artifact_name(prompt)
                try:
                    async with save_lock:
                        art = await artifact_service.create(
                            name=artifact_name,
                            kind=ArtifactKind.IMAGE,
                            content_base64=content_b64,
                            mime_type=img.mime_type,
                            workspace_id=workspace_id,
                            conversation_id=conversation_id,
                            created_by_employee_id=employee_id,
                            metadata={
                                "image_gen": True,
                                "model": result.model_used,
                                "provider": result.provider_id,
                                "prompt": img.prompt,
                                "revised_prompt": img.revised_prompt,
                                "size": img.size,
                            },
                        )
                except Exception as exc:
                    return {
                        "error": f"failed to save artifact: {exc.__class__.__name__}",
                        "prompt": prompt[:100],
                        "hint": "Check workspace_id and that artifact storage is healthy.",
                    }
                artifacts_out.append(
                    {
                        "artifact_id": art.id,
                        "url": f"/api/artifacts/{art.id}/content",
                        "prompt": prompt,
                        "mime_type": img.mime_type,
                        "size": img.size,
                        "revised_prompt": img.revised_prompt,
                    }
                )
            return {"images": artifacts_out, "duration_ms": result.duration_ms}

        per_prompt_results = await asyncio.gather(*(_one(p) for p in prompts))

        flat_images: list[dict[str, Any]] = []
        total_duration = 0
        for res in per_prompt_results:
            if "images" in res:
                flat_images.extend(res["images"])
                total_duration = max(total_duration, res.get("duration_ms", 0))
            else:
                flat_images.append({k: v for k, v in res.items() if k != "images"})

        # cost estimate uses model name (Gateway already used the right adapter)
        model_name = getattr(model, "name", "")
        cost = estimate_cost(model_name=model_name, quality=quality, size=size, n=len(flat_images))

        return {
            "images": flat_images,
            "total_cost_usd": cost,
            "duration_ms": total_duration,
        }

    return _execute

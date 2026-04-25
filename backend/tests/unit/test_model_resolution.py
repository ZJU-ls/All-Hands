"""Unit tests for execution.model_resolution.

Post-2026-04-25 default-pointer refactor: "the workspace default" is now a
singleton flag on a specific ``LLMModel`` row (``is_default=True``) rather
than the legacy ``provider.is_default`` + ``provider.default_model`` pair.
Tests now mark a model as default — their provider is just the model's
parent.
"""

from __future__ import annotations

import pytest

from allhands.core.errors import DomainError
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.model_resolution import resolve_effective_model


def _provider(
    pid: str,
    name: str,
    kind: str = "openai",
    enabled: bool = True,
) -> LLMProvider:
    return LLMProvider(
        id=pid,
        name=name,
        kind=kind,  # type: ignore[arg-type]
        base_url="https://example.test",
        api_key="sk-x",
        enabled=enabled,
    )


def _model(
    mid: str,
    provider_id: str,
    name: str,
    *,
    enabled: bool = True,
    is_default: bool = False,
) -> LLMModel:
    return LLMModel(
        id=mid,
        provider_id=provider_id,
        name=name,
        enabled=enabled,
        is_default=is_default,
    )


class TestResolveEffectiveModel:
    def test_conv_override_wins_when_valid(self) -> None:
        providers = [
            _provider("p1", "OpenAI", kind="openai"),
            _provider("p2", "CODINGPLAN", kind="aliyun"),
        ]
        models = [
            _model("m1", "p1", "gpt-4o-mini", is_default=True),
            _model("m2", "p2", "qwen3.6-plus"),
        ]
        out = resolve_effective_model(
            conv_override="CODINGPLAN/qwen3.6-plus",
            employee_ref="OpenAI/gpt-4o-mini",
            providers=providers,
            models=models,
        )
        assert out.source == "override"
        assert out.provider.id == "p2"
        assert out.model_name == "qwen3.6-plus"

    def test_employee_ref_used_when_no_override(self) -> None:
        providers = [_provider("p1", "OpenAI")]
        models = [_model("m1", "p1", "gpt-4o-mini", is_default=True)]
        out = resolve_effective_model(
            conv_override=None,
            employee_ref="OpenAI/gpt-4o-mini",
            providers=providers,
            models=models,
        )
        assert out.source == "employee"
        assert out.ref == "OpenAI/gpt-4o-mini"

    def test_falls_through_to_global_default_when_employee_ref_unmatched(self) -> None:
        """Screenshot scenario: employee says openai/gpt-4o-mini but only
        CODINGPLAN (aliyun, strict registry) is configured."""
        providers = [_provider("p2", "CODINGPLAN", kind="aliyun")]
        models = [
            _model("m2", "p2", "qwen3.6-plus", is_default=True),
            _model("m3", "p2", "glm-5"),
        ]
        out = resolve_effective_model(
            conv_override=None,
            employee_ref="openai/gpt-4o-mini",
            providers=providers,
            models=models,
        )
        assert out.source == "global_default"
        assert out.provider.id == "p2"
        assert out.model_name == "qwen3.6-plus"

    def test_falls_through_when_model_not_in_registered_list(self) -> None:
        providers = [_provider("p2", "CODINGPLAN", kind="aliyun")]
        models = [_model("m2", "p2", "qwen3.6-plus", is_default=True)]
        out = resolve_effective_model(
            conv_override="CODINGPLAN/some-unregistered",
            employee_ref=None,
            providers=providers,
            models=models,
        )
        assert out.source == "global_default"
        assert out.model_name == "qwen3.6-plus"

    def test_openai_kind_passes_through_unregistered_model(self) -> None:
        """OpenRouter-style aggregators accept slash-routed refs; we keep
        pass-through so day-1 unregistered usage still works."""
        providers = [_provider("p1", "OpenRouter", kind="openai")]
        models = [_model("m1", "p1", "gpt-4o-mini", is_default=True)]
        out = resolve_effective_model(
            conv_override="OpenRouter/anthropic/claude-3-5-sonnet",
            employee_ref=None,
            providers=providers,
            models=models,
        )
        assert out.source == "override"
        assert out.model_name == "anthropic/claude-3-5-sonnet"

    def test_empty_registered_models_passes_through(self) -> None:
        """Day-1 setup: provider added but no models registered yet."""
        providers = [_provider("p1", "OpenAI", kind="openai")]
        models: list[LLMModel] = []
        out = resolve_effective_model(
            conv_override=None,
            employee_ref="OpenAI/gpt-4o-mini",
            providers=providers,
            models=models,
        )
        assert out.source == "employee"
        assert out.model_name == "gpt-4o-mini"

    def test_disabled_provider_is_skipped(self) -> None:
        """Default model under a disabled provider can't be the workspace
        default — fall through to the first enabled provider's first
        registered model."""
        providers = [
            _provider("p1", "OpenAI", enabled=False),
            _provider("p2", "CODINGPLAN", kind="aliyun"),
        ]
        models = [
            _model("m1", "p1", "gpt-4o-mini", is_default=True),  # parent disabled
            _model("m2", "p2", "qwen3.6-plus"),
        ]
        out = resolve_effective_model(
            conv_override=None,
            employee_ref=None,
            providers=providers,
            models=models,
        )
        assert out.source == "global_default"
        assert out.provider.id == "p2"
        assert out.model_name == "qwen3.6-plus"

    def test_disabled_model_is_not_matched(self) -> None:
        providers = [_provider("p1", "CODINGPLAN", kind="aliyun")]
        models = [
            _model("m1", "p1", "qwen3.6-plus", is_default=True),
            _model("m2", "p1", "glm-5", enabled=False),
        ]
        out = resolve_effective_model(
            conv_override="CODINGPLAN/glm-5",
            employee_ref=None,
            providers=providers,
            models=models,
        )
        # Disabled model isn't a valid binding — fall through to default.
        assert out.source == "global_default"
        assert out.model_name == "qwen3.6-plus"

    def test_bare_name_resolves_against_default_provider(self) -> None:
        providers = [_provider("p1", "OpenAI")]
        models = [_model("m1", "p1", "gpt-4o-mini", is_default=True)]
        out = resolve_effective_model(
            conv_override=None,
            employee_ref="gpt-4o-mini",
            providers=providers,
            models=models,
        )
        assert out.source == "employee"
        assert out.provider.id == "p1"
        assert out.model_name == "gpt-4o-mini"

    def test_no_providers_raises(self) -> None:
        with pytest.raises(DomainError):
            resolve_effective_model(
                conv_override=None,
                employee_ref="OpenAI/gpt-4o-mini",
                providers=[],
                models=[],
            )

    def test_no_default_flag_falls_back_to_first_provider_first_model(self) -> None:
        """No model has is_default=True yet (post-bootstrap, pre-pick) →
        the resolver picks the first enabled provider's first enabled
        model so the system bootstraps before the user has chosen."""
        providers = [_provider("p1", "OpenAI"), _provider("p2", "CODINGPLAN", kind="aliyun")]
        models = [_model("m1", "p1", "gpt-4o-mini"), _model("m2", "p2", "qwen3.6-plus")]
        out = resolve_effective_model(
            conv_override=None,
            employee_ref=None,
            providers=providers,
            models=models,
        )
        assert out.source == "global_default"
        assert out.provider.id == "p1"
        assert out.model_name == "gpt-4o-mini"

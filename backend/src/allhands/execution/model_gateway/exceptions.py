"""Gateway-level exceptions · ADR 0021 self-explanation envelopes.

Adapter-level errors (ImageProviderError / VideoProviderError) live in
each modality's domain module — they carry wire-level context. The
exceptions here are *routing* errors: the Gateway can't find or matches
the wrong adapter.

Tool layer catches these via duck-typing on ``.to_dict()`` and ships the
structured envelope back to the LLM, just like skill_scripts does.
"""

from __future__ import annotations

from allhands.core.modality import Modality


class ModelGatewayError(Exception):
    """Base · all gateway routing errors derive from this."""

    def to_dict(self) -> dict[str, object]:
        return {"error": str(self), "type": self.__class__.__name__}


class NoAdapterFoundError(ModelGatewayError):
    """No registered adapter accepts (modality, provider, model)."""

    def __init__(
        self,
        *,
        modality: Modality,
        provider: str,
        model: str,
        reason: str,
    ) -> None:
        super().__init__(reason)
        self.modality = modality
        self.provider = provider
        self.model = model
        self.reason = reason

    def to_dict(self) -> dict[str, object]:
        return {
            "error": self.reason,
            "type": self.__class__.__name__,
            "field": "model_ref",
            "expected": (
                f"a {self.modality.value} adapter accepting ({self.provider}, {self.model})"
            ),
            "received": f"({self.provider}, {self.model})",
            "hint": (
                "Register a matching adapter in api/deps.py, or check the "
                "model's capabilities in /settings/providers."
            ),
        }


class AdapterMismatchError(ModelGatewayError):
    """Adapter declared one modality but instance type doesn't match.

    Defensive · should never trigger if adapter authors set the class
    attribute correctly. Surfaces a clear bug message during boot if it
    does.
    """


__all__ = [
    "AdapterMismatchError",
    "ModelGatewayError",
    "NoAdapterFoundError",
]

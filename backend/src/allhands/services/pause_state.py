"""Process-local workspace pause switch (cockpit spec § 4.3/§ 4.4).

v0 scope: a single boolean + reason shared between the REST pause-all endpoint
and the cockpit summary. When a real run registry lands (spec § 9), the switch
here will also flip the registry into reject-all mode and cancel active runs.

This module exposes a **single** `PauseSwitch` class. Wire a single instance
through FastAPI `Depends` so all callers see the same state.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from allhands.services.cockpit_service import PauseState


@dataclass
class _State:
    paused: bool = False
    reason: str | None = None
    paused_at: datetime | None = None


class PauseSwitch:
    def __init__(self) -> None:
        self._state = _State()

    def snapshot(self) -> PauseState:
        return PauseState(
            paused=self._state.paused,
            reason=self._state.reason,
            paused_at=self._state.paused_at,
        )

    def pause(self, reason: str | None = None) -> PauseState:
        if not self._state.paused:
            self._state.paused = True
            self._state.reason = reason
            self._state.paused_at = datetime.now(UTC)
        return self.snapshot()

    def resume(self) -> PauseState:
        self._state.paused = False
        self._state.reason = None
        self._state.paused_at = None
        return self.snapshot()


__all__ = ["PauseSwitch"]

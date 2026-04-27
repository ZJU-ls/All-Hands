"""Unit tests for `allhands-seed` CLI safety + startup gating.

2026-04-27 contract change: demo seeds are now strict opt-in via
``ALLHANDS_SEED_DEMO=1`` (or legacy ``ALLHANDS_SEED=1``). Cold start no
longer auto-loads demo data even in dev — a fresh clone shows only Lead
Agent + builtin skills.
"""

from __future__ import annotations

import os

import pytest

from allhands.cli.seed import _do_reset, build_parser
from allhands.main import _should_seed_demo


class TestShouldSeedDemo:
    def test_off_by_default_in_any_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ALLHANDS_SEED_DEMO", raising=False)
        monkeypatch.delenv("ALLHANDS_SEED", raising=False)
        assert _should_seed_demo() is False

    def test_enabled_when_seed_demo_flag_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ALLHANDS_SEED_DEMO", "1")
        assert _should_seed_demo() is True

    def test_legacy_seed_flag_still_works(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ALLHANDS_SEED_DEMO", raising=False)
        monkeypatch.setenv("ALLHANDS_SEED", "1")
        assert _should_seed_demo() is True

    def test_only_literal_one_enables(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ALLHANDS_SEED_DEMO", "true")  # only "1" enables
        assert _should_seed_demo() is False


class TestSeedResetSafety:
    async def test_reset_refused_when_env_is_not_dev(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setenv("ALLHANDS_ENV", "prod")
        # clear cached settings so the monkeypatched env is observed
        from allhands.config import get_settings

        get_settings.cache_clear()

        rc = await _do_reset()
        assert rc == 2
        captured = capsys.readouterr()
        assert "refused" in captured.err.lower()
        # Restore cache cleared for other tests.
        get_settings.cache_clear()


class TestCliArgParsing:
    def test_requires_subcommand(self) -> None:
        parser = build_parser()
        with pytest.raises(SystemExit):
            parser.parse_args([])

    def test_accepts_dev_subcommand(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["dev"])
        assert args.command == "dev"

    def test_accepts_reset_subcommand(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["reset"])
        assert args.command == "reset"


# Guardrail for the test env not leaking into later runs.
@pytest.fixture(autouse=True)
def _restore_env() -> None:
    saved = {k: os.environ.get(k) for k in ("ALLHANDS_ENV", "ALLHANDS_SEED", "ALLHANDS_SEED_DEMO")}
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v

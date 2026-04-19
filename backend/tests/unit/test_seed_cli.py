"""Unit tests for `allhands-seed` CLI safety + startup gating (I-0020)."""

from __future__ import annotations

import os

import pytest

from allhands.cli.seed import _do_reset, build_parser
from allhands.main import _should_seed


class TestShouldSeed:
    def test_dev_env_seeds(self) -> None:
        assert _should_seed("dev") is True

    def test_test_env_seeds(self) -> None:
        assert _should_seed("test") is True

    def test_prod_env_does_not_seed_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ALLHANDS_SEED", raising=False)
        assert _should_seed("prod") is False

    def test_prod_env_seeds_when_explicit_flag_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ALLHANDS_SEED", "1")
        assert _should_seed("prod") is True

    def test_prod_env_ignores_other_seed_values(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ALLHANDS_SEED", "true")  # only literal "1" enables
        assert _should_seed("prod") is False


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
    original_env = os.environ.get("ALLHANDS_ENV")
    original_seed = os.environ.get("ALLHANDS_SEED")
    yield
    if original_env is None:
        os.environ.pop("ALLHANDS_ENV", None)
    else:
        os.environ["ALLHANDS_ENV"] = original_env
    if original_seed is None:
        os.environ.pop("ALLHANDS_SEED", None)
    else:
        os.environ["ALLHANDS_SEED"] = original_seed

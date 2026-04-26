"""Unit tests for the backend i18n module + LocaleMiddleware."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from allhands.api.middleware import LocaleMiddleware
from allhands.i18n import (
    DEFAULT_LOCALE,
    LOCALE_COOKIE,
    get_current_locale,
    negotiate_locale,
    reset_current_locale,
    set_current_locale,
    t,
)


def test_negotiate_locale_picks_zh_for_zh_cn() -> None:
    assert negotiate_locale("zh-CN,zh;q=0.9,en;q=0.8") == "zh-CN"


def test_negotiate_locale_picks_en_for_en_us() -> None:
    assert negotiate_locale("en-US,en;q=0.9") == "en"


def test_negotiate_locale_falls_back_when_unknown() -> None:
    assert negotiate_locale("ja-JP,ja") == DEFAULT_LOCALE
    assert negotiate_locale(None) == DEFAULT_LOCALE
    assert negotiate_locale("") == DEFAULT_LOCALE


def test_t_returns_localized_string_per_context() -> None:
    token = set_current_locale("en")
    try:
        assert t("errors.not_found.provider") == "Provider not found."
    finally:
        reset_current_locale(token)

    token = set_current_locale("zh-CN")
    try:
        assert t("errors.not_found.provider") == "供应商不存在"
    finally:
        reset_current_locale(token)


def test_t_falls_back_to_key_when_missing() -> None:
    token = set_current_locale("en")
    try:
        assert t("does.not.exist") == "does.not.exist"
    finally:
        reset_current_locale(token)


def test_t_supports_format_kwargs() -> None:
    token = set_current_locale("en")
    try:
        assert t("errors.invalid_status_filter", detail="bad") == "Invalid status filter: bad"
    finally:
        reset_current_locale(token)


def test_round_5_new_keys_have_both_locales() -> None:
    """Newly added keys in round 5 must exist in both locales with the
    expected ICU placeholders. Acts as a regression net for half-translated
    additions."""
    new_keys = [
        "errors.not_found.employee_id",
        "errors.not_found.conversation_id",
        "errors.not_found.trace_id",
        "errors.not_found.run_id",
        "errors.not_found.document_in_kb",
        "errors.not_found.user_input",
        "errors.unknown_kind",
        "errors.unknown_preset",
        "errors.transport_invalid",
        "errors.kb_fetch_failed",
        "errors.answers_not_dict",
    ]
    for key in new_keys:
        for locale in ("zh-CN", "en"):
            tok = set_current_locale(locale)
            try:
                # `t(key)` returns the key itself if missing — anything else means a hit.
                value = t(key, id="X", kind="X", preset="X", raw="X", detail="X")
                assert value != key, f"{locale}: missing key {key}"
                assert value.strip() != "", f"{locale}: empty translation for {key}"
            finally:
                reset_current_locale(tok)


def test_catalog_zh_en_have_same_key_shape() -> None:
    """zh-CN and en catalogs must define the same keys — guards against
    half-merged additions where one locale gets a new error and the other
    falls back to the key string."""
    from allhands.i18n import _MESSAGES  # type: ignore[attr-defined]

    zh = set(_MESSAGES["zh-CN"].keys())
    en = set(_MESSAGES["en"].keys())
    only_zh = zh - en
    only_en = en - zh
    assert not only_zh, f"zh-CN keys missing in en: {sorted(only_zh)}"
    assert not only_en, f"en keys missing in zh-CN: {sorted(only_en)}"


def _build_probe_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(LocaleMiddleware)

    @app.get("/probe")
    def probe() -> dict[str, str]:
        return {"locale": get_current_locale(), "msg": t("errors.not_found.provider")}

    return app


def test_middleware_uses_cookie_over_header() -> None:
    client = TestClient(_build_probe_app())
    r = client.get(
        "/probe",
        headers={"Accept-Language": "en"},
        cookies={LOCALE_COOKIE: "zh-CN"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["locale"] == "zh-CN"
    assert body["msg"] == "供应商不存在"
    assert r.headers["content-language"] == "zh-CN"


def test_middleware_falls_back_to_accept_language() -> None:
    client = TestClient(_build_probe_app())
    r = client.get("/probe", headers={"Accept-Language": "en-US,en;q=0.9"})
    assert r.status_code == 200
    body = r.json()
    assert body["locale"] == "en"
    assert body["msg"] == "Provider not found."


def test_middleware_falls_back_to_default_with_no_signals() -> None:
    client = TestClient(_build_probe_app())
    r = client.get("/probe")
    assert r.json()["locale"] == DEFAULT_LOCALE

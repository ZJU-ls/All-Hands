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

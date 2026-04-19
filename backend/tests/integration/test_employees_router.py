"""End-to-end tests for /api/employees · L01 扩展(2026-04-18)的 REST 对偶。

Employee 走 "一份实现(EmployeeService)· 两个入口(REST + Meta Tool)" · 这里
验证 REST 入口的 POST / PATCH / DELETE + /preview 行为。Preset → tool_ids/
skill_ids/max_iterations 映射属于 Phase 3B,等 Track M 契约落地后补。

**红线:** 提交体不得包含 `mode` 字段;数据库不得持有 preset。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_employee_service, get_session
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlEmployeeRepo
from allhands.services.employee_service import EmployeeService


@pytest.fixture
def client() -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    async def _emp_service(session: AsyncSession = Depends(_session)) -> EmployeeService:
        return EmployeeService(SqlEmployeeRepo(session))

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_employee_service] = _emp_service
    return TestClient(app)


def test_list_empty(client: TestClient) -> None:
    r = client.get("/api/employees")
    assert r.status_code == 200
    assert r.json() == []


def test_create_employee_returns_201_and_shape(client: TestClient) -> None:
    r = client.post(
        "/api/employees",
        json={
            "name": "researcher-a",
            "description": "web research employee",
            "system_prompt": "You are a thorough researcher.",
            "model_ref": "openai/gpt-4o-mini",
            "tool_ids": ["allhands.builtin.fetch_url"],
            "skill_ids": ["sk_research"],
            "max_iterations": 10,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "researcher-a"
    assert body["tool_ids"] == ["allhands.builtin.fetch_url"]
    assert body["skill_ids"] == ["sk_research"]
    assert body["max_iterations"] == 10
    assert body["is_lead_agent"] is False
    # 红线:response 不泄露 mode 字段
    assert "mode" not in body


def test_create_employee_rejects_empty_capabilities(client: TestClient) -> None:
    r = client.post(
        "/api/employees",
        json={
            "name": "empty",
            "description": "d",
            "system_prompt": "p",
            "model_ref": "openai/gpt-4o-mini",
            "tool_ids": [],
            "skill_ids": [],
        },
    )
    assert r.status_code == 400


def test_create_employee_rejects_mode_field(client: TestClient) -> None:
    """§3.2 红线:请求体出现 mode 字段 → 422(模型拒绝 extra)。"""
    r = client.post(
        "/api/employees",
        json={
            "name": "should-fail",
            "description": "d",
            "system_prompt": "p",
            "model_ref": "openai/gpt-4o-mini",
            "tool_ids": ["allhands.builtin.fetch_url"],
            "skill_ids": [],
            "mode": "execute",  # forbidden
        },
    )
    assert r.status_code == 422


def test_update_employee_partial_fields(client: TestClient) -> None:
    created = client.post(
        "/api/employees",
        json={
            "name": "upd-1",
            "description": "d",
            "system_prompt": "p",
            "model_ref": "openai/gpt-4o-mini",
            "tool_ids": ["allhands.builtin.fetch_url"],
            "skill_ids": [],
            "max_iterations": 10,
        },
    ).json()
    r = client.patch(
        f"/api/employees/{created['id']}",
        json={"description": "updated", "max_iterations": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["description"] == "updated"
    assert body["max_iterations"] == 5
    # unchanged fields preserved
    assert body["tool_ids"] == ["allhands.builtin.fetch_url"]


def test_delete_employee_204_then_404(client: TestClient) -> None:
    created = client.post(
        "/api/employees",
        json={
            "name": "del-1",
            "description": "d",
            "system_prompt": "p",
            "model_ref": "openai/gpt-4o-mini",
            "tool_ids": ["allhands.builtin.fetch_url"],
            "skill_ids": [],
        },
    ).json()
    assert client.delete(f"/api/employees/{created['id']}").status_code == 204
    assert client.get(f"/api/employees/{created['id']}").status_code == 404


def test_delete_missing_returns_404(client: TestClient) -> None:
    assert client.delete("/api/employees/missing").status_code == 404

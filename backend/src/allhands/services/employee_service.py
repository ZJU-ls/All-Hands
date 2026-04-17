"""EmployeeService — application-level use cases for employee management."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import Employee, EmployeeNotFound

if TYPE_CHECKING:
    from allhands.persistence.repositories import EmployeeRepo


class EmployeeService:
    def __init__(self, repo: EmployeeRepo) -> None:
        self._repo = repo

    async def create(
        self,
        name: str,
        description: str,
        system_prompt: str,
        model_ref: str,
        tool_ids: list[str] | None = None,
        skill_ids: list[str] | None = None,
        max_iterations: int = 10,
        is_lead_agent: bool = False,
        created_by: str = "user",
    ) -> Employee:
        tids = tool_ids or []
        sids = skill_ids or []
        if not tids and not sids:
            raise ValueError(
                "Employee must have at least one tool or skill capability."
            )
        employee = Employee(
            id=str(uuid.uuid4()),
            name=name,
            description=description,
            system_prompt=system_prompt,
            model_ref=model_ref,
            tool_ids=tids,
            skill_ids=sids,
            max_iterations=max_iterations,
            is_lead_agent=is_lead_agent,
            created_by=created_by,
            created_at=datetime.now(UTC),
        )
        return await self._repo.upsert(employee)

    async def get(self, employee_id: str) -> Employee:
        emp = await self._repo.get(employee_id)
        if emp is None:
            raise EmployeeNotFound(f"Employee {employee_id!r} not found.")
        return emp

    async def get_by_name(self, name: str) -> Employee | None:
        return await self._repo.get_by_name(name)

    async def get_lead(self) -> Employee | None:
        return await self._repo.get_lead()

    async def list_all(self) -> list[Employee]:
        return await self._repo.list_all()

    async def update(
        self,
        employee_id: str,
        *,
        description: str | None = None,
        system_prompt: str | None = None,
        model_ref: str | None = None,
        tool_ids: list[str] | None = None,
        skill_ids: list[str] | None = None,
        max_iterations: int | None = None,
    ) -> Employee:
        emp = await self.get(employee_id)
        updated = emp.model_copy(
            update={
                k: v
                for k, v in {
                    "description": description,
                    "system_prompt": system_prompt,
                    "model_ref": model_ref,
                    "tool_ids": tool_ids,
                    "skill_ids": skill_ids,
                    "max_iterations": max_iterations,
                }.items()
                if v is not None
            }
        )
        return await self._repo.upsert(updated)

    async def delete(self, employee_id: str) -> None:
        await self.get(employee_id)  # raises if not found
        await self._repo.delete(employee_id)

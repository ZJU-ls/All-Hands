"""EmployeeService — application-level use cases for employee management.

Enforces the dispatch-mount invariants from agent-design § 7:

- `is_lead_agent=True` auto-injects `dispatch_employee` + `list_employees` +
  `get_employee_detail` so the Lead always has the coordination toolkit.
- A non-Lead employee may mount `dispatch_employee` (sub-lead pattern), but
  it MUST also mount `list_employees` + `get_employee_detail` — without the
  "who can I delegate to?" tools, dispatch is a blind shot.
- Any other combination with `dispatch_employee` is rejected as an invariant
  violation.

Default skill injection (§ 13.5.3): new employees created without an explicit
`skill_ids` list get `DEFAULT_SKILL_IDS` so every employee starts with the
"output" skills (render + artifacts) needed to produce visible work.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import Employee, EmployeeNotFound, InvariantViolation
from allhands.execution.modes import expand_preset

if TYPE_CHECKING:
    from allhands.persistence.repositories import EmployeeRepo


log = logging.getLogger(__name__)

DISPATCH_TOOL_ID = "allhands.meta.dispatch_employee"
LIST_EMPLOYEES_TOOL_ID = "allhands.meta.list_employees"
GET_EMPLOYEE_DETAIL_TOOL_ID = "allhands.meta.get_employee_detail"

COORDINATION_TOOL_IDS: tuple[str, ...] = (
    DISPATCH_TOOL_ID,
    LIST_EMPLOYEES_TOOL_ID,
    GET_EMPLOYEE_DETAIL_TOOL_ID,
)

DEFAULT_SKILL_IDS: tuple[str, ...] = ("allhands.render", "allhands.artifacts")

# E22 · Lead-specific skill pack.
# Normal employees get DEFAULT_SKILL_IDS (render + artifacts). The Lead Agent
# additionally gets 5 platform-admin packs, descriptor-only at turn 0; their
# tool_ids load on ``resolve_skill`` activation. This is how the Claude-Code
# style progressive loading lands for platform management — Lead's prompt
# stays small, tool-schema bloat is gated behind user intent.
LEAD_EXTRA_SKILL_IDS: tuple[str, ...] = (
    "allhands.team_management",
    "allhands.model_management",
    "allhands.skill_management",
    "allhands.mcp_management",
    "allhands.cockpit_admin",
    # 2026-04-25 · 渐进式 skill pack · spec
    # docs/specs/2026-04-25-progressive-skill-packs.md
    # 把原本裸露在 ALL_*_TOOLS 里的 36 个 meta tool 装进 6 个新 skill ·
    # Lead 上下文 -8.7k token / turn(冷激活路径)。其他员工也可以挂 ·
    # 例如 「金融分析师」 = market_data + stock_assistant + artifacts。
    "allhands.triggers_management",
    "allhands.channels_management",
    "allhands.task_management",
    "allhands.market_data",
    "allhands.observatory",
    "allhands.review_gates",
    # 2026-04-27 round-22 · 品牌设计语言挂上 Lead · 用户说「画个高大上的
    # 落地页 / 海报 / 仪表盘」 时 Lead turn 0 就看到 allhands.design
    # 描述符 ·  触发关键词命中即激活 · 注入 Brand Blue 双主题 token +
    # 模板 · 产出比默认 ChatGPT 大白页有品牌感。
    # NOTE: 老的 allhands.drawio-creator 已在 round-21 P3 物理删除 · 数据
    # 迁移见 alembic 0029。drawio 能力现在挂在 allhands.artifacts skill 里。
    "allhands.design",
)
LEAD_SKILL_IDS: tuple[str, ...] = DEFAULT_SKILL_IDS + LEAD_EXTRA_SKILL_IDS


def _inject_coordination_tools(tool_ids: list[str]) -> list[str]:
    out = list(tool_ids)
    for t in COORDINATION_TOOL_IDS:
        if t not in out:
            out.append(t)
    return out


def _validate_dispatch_mount(tool_ids: list[str], is_lead_agent: bool) -> None:
    if is_lead_agent:
        return
    if DISPATCH_TOOL_ID not in tool_ids:
        return
    missing = [
        t for t in (LIST_EMPLOYEES_TOOL_ID, GET_EMPLOYEE_DETAIL_TOOL_ID) if t not in tool_ids
    ]
    if missing:
        raise InvariantViolation(
            "Non-Lead employee mounts dispatch_employee but is missing "
            f"coordination tool(s): {missing}. Sub-lead employees MUST also "
            "mount list_employees + get_employee_detail, otherwise they cannot "
            "decide who to delegate to."
        )
    log.warning(
        "employee.sub_lead_mount",
        extra={"detail": "non-Lead employee mounts dispatch_employee (sub-lead pattern)"},
    )


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
        max_iterations: int | None = None,
        is_lead_agent: bool = False,
        created_by: str = "user",
        preset: str | None = None,
        status: str = "draft",
    ) -> Employee:
        if preset is not None:
            # contract § 4.2 · UI form preset collapses into (tool_ids,
            # skill_ids, max_iterations). NO `mode` field is stored — CLAUDE.md
            # §3.2 red line. The preset name is a *template choice* at creation
            # time; the employee that comes out is an ordinary unified-react
            # agent differentiated only by those three scalars. Passing
            # `max_iterations=None` lets the preset's own budget win (contract
            # § 4.2 default precedence).
            tids_list, sids_list, max_iterations = expand_preset(
                preset,
                custom_tool_ids=tool_ids,
                custom_skill_ids=skill_ids,
                custom_max_iterations=max_iterations,
            )
            tids = tids_list
            sids = sids_list
        else:
            tids = list(tool_ids) if tool_ids is not None else []
            sids = list(skill_ids) if skill_ids is not None else list(DEFAULT_SKILL_IDS)
            if max_iterations is None:
                max_iterations = 10
        if is_lead_agent:
            tids = _inject_coordination_tools(tids)
        _validate_dispatch_mount(tids, is_lead_agent)
        if not tids and not sids:
            raise ValueError("Employee must have at least one tool or skill capability.")
        if status not in ("draft", "published"):
            raise ValueError(f"Invalid employee status: {status!r}")
        now = datetime.now(UTC)
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
            status=status,  # type: ignore[arg-type]
            created_by=created_by,
            created_at=now,
            published_at=now if status == "published" else None,
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

    async def list_all(self, *, status: str | None = None) -> list[Employee]:
        return await self._repo.list_all(status=status)

    async def publish(self, employee_id: str) -> Employee:
        emp = await self.get(employee_id)
        if emp.status == "published":
            return emp
        updated = emp.model_copy(update={"status": "published", "published_at": datetime.now(UTC)})
        return await self._repo.upsert(updated)

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
        new_tool_ids = list(tool_ids) if tool_ids is not None else list(emp.tool_ids)
        if emp.is_lead_agent:
            new_tool_ids = _inject_coordination_tools(new_tool_ids)
        _validate_dispatch_mount(new_tool_ids, emp.is_lead_agent)
        updated = emp.model_copy(
            update={
                k: v
                for k, v in {
                    "description": description,
                    "system_prompt": system_prompt,
                    "model_ref": model_ref,
                    "tool_ids": new_tool_ids if tool_ids is not None else None,
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

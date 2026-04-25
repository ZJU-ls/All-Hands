"""System / installation paths endpoint.

Exposes the resolved on-disk paths the runtime is using so the settings UI
can show them, copy-paste them, and (in a future desktop shell · Electron /
Tauri) trigger ``shell.openPath`` to reveal the folder in Finder / Explorer.

Read-only on purpose: changing ``skills_dir`` etc. requires editing ``.env``
or env-vars + restarting the backend, since live migration of installed
skill content / artifact blobs is a separate effort (see ADR design doc
2026-04-25).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from allhands.config.settings import get_settings

router = APIRouter(prefix="/system", tags=["system"])


class SystemPathEntry(BaseModel):
    """One row in the storage table.

    ``key`` is a stable identifier for the UI (used as React key + for the
    optional desktop ``openPath`` IPC). ``description`` is end-user-facing
    text in the active locale. ``path`` is always absolute.
    ``configurable`` tells the UI whether the user can override it via env
    var (in v0 only via .env / restart; the field is here so the future
    settings page can render an "edit" affordance for the right rows).
    """

    key: str
    label: str
    description: str
    path: str
    env_var: str | None = None
    configurable: bool = False
    builtin: bool = False


class SystemPathsResponse(BaseModel):
    paths: list[SystemPathEntry]


def _build_paths() -> list[SystemPathEntry]:
    """Sync builder · path arithmetic only · no filesystem syscalls.

    Pulled out of the async handler so ruff's ASYNC240 doesn't flag every
    Path() call. Pure compute,fine to call from anywhere.
    """
    settings = get_settings()
    db_url_path = settings.database_url.split("///", 1)[-1]
    builtin_skills = Path("skills") / "builtin"
    db_path = Path(db_url_path) if db_url_path else None
    return [
        SystemPathEntry(
            key="data_dir",
            label="数据根目录 · Data root",
            description="所有文件型状态的根 · sqlite 数据库 / 已安装技能 / 制品 blob 都默认放在它下面。",
            path=str(Path(settings.data_dir).absolute()),
            env_var="ALLHANDS_DATA_DIR",
            configurable=True,
        ),
        SystemPathEntry(
            key="database",
            label="SQLite 数据库 · Database",
            description="主数据库文件 · 对话 / 消息 / 制品元数据 / 技能注册表都在这里。",
            path=str(db_path.absolute()) if db_path else "",
            env_var="ALLHANDS_DATABASE_URL",
            configurable=True,
        ),
        SystemPathEntry(
            key="skills_dir",
            label="已安装技能 · Installed skills",
            description=(
                "用户通过 zip / GitHub 安装的技能存放目录。每个技能一个子文件夹。"
                "默认 <data_dir>/skills,可通过 ALLHANDS_SKILLS_DIR 覆盖。"
            ),
            path=str(settings.resolved_skills_dir()),
            env_var="ALLHANDS_SKILLS_DIR",
            configurable=True,
        ),
        SystemPathEntry(
            key="builtin_skills_dir",
            label="内置技能 · Built-in skills",
            description="跟随后端代码发布的只读技能集 · 不会被「已安装技能」目录污染。",
            path=str(builtin_skills.absolute()),
            builtin=True,
        ),
        SystemPathEntry(
            key="artifacts_dir",
            label="制品 blob · Artifacts",
            description=(
                "Agent 产出的 markdown / 代码 / 图片 / drawio / mermaid 文件存盘位置。"
                "默认 <data_dir>/artifacts,可通过 ALLHANDS_ARTIFACTS_DIR 覆盖。"
            ),
            path=str(settings.resolved_artifacts_dir()),
            env_var="ALLHANDS_ARTIFACTS_DIR",
            configurable=True,
        ),
    ]


@router.get("/paths", response_model=SystemPathsResponse)
async def get_system_paths() -> SystemPathsResponse:
    return SystemPathsResponse(paths=_build_paths())

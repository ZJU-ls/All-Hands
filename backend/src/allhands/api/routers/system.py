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
from allhands.i18n import t

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
            label=t("system.paths.data_dir.label"),
            description=t("system.paths.data_dir.description"),
            path=str(Path(settings.data_dir).absolute()),
            env_var="ALLHANDS_DATA_DIR",
            configurable=True,
        ),
        SystemPathEntry(
            key="database",
            label=t("system.paths.database.label"),
            description=t("system.paths.database.description"),
            path=str(db_path.absolute()) if db_path else "",
            env_var="ALLHANDS_DATABASE_URL",
            configurable=True,
        ),
        SystemPathEntry(
            key="skills_dir",
            label=t("system.paths.skills_dir.label"),
            description=t("system.paths.skills_dir.description"),
            path=str(settings.resolved_skills_dir()),
            env_var="ALLHANDS_SKILLS_DIR",
            configurable=True,
        ),
        SystemPathEntry(
            key="builtin_skills_dir",
            label=t("system.paths.builtin_skills_dir.label"),
            description=t("system.paths.builtin_skills_dir.description"),
            path=str(builtin_skills.absolute()),
            builtin=True,
        ),
        SystemPathEntry(
            key="artifacts_dir",
            label=t("system.paths.artifacts_dir.label"),
            description=t("system.paths.artifacts_dir.description"),
            path=str(settings.resolved_artifacts_dir()),
            env_var="ALLHANDS_ARTIFACTS_DIR",
            configurable=True,
        ),
    ]


@router.get("/paths", response_model=SystemPathsResponse)
async def get_system_paths() -> SystemPathsResponse:
    return SystemPathsResponse(paths=_build_paths())

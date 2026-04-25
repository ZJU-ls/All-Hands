"""Runtime configuration.

All config is loaded from env vars (or .env). See .env.example for the full list.
Settings is cached as a module-level singleton via get_settings().
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="ALLHANDS_",
        extra="ignore",
    )

    env: str = Field(default="dev", description="dev | test | prod")
    log_level: str = Field(default="INFO")

    data_dir: str = Field(
        default="./data",
        description="Root for file-backed state: sqlite, installed skills, uploads.",
    )
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/app.db",
        description="Async SQLAlchemy URL. Default uses local SQLite under ./data.",
    )
    checkpoint_db_path: str = Field(
        default="./data/checkpoints.db",
        description="Path for LangGraph AsyncSqliteSaver. Separate from app DB on purpose.",
    )

    langfuse_host: str | None = Field(default=None)
    langfuse_public_key: str | None = Field(default=None)
    langfuse_secret_key: str | None = Field(default=None)

    openai_api_key: str | None = Field(default=None)
    openai_base_url: str | None = Field(default=None)
    default_model_ref: str = Field(default="openai/gpt-4o-mini")

    # Alibaba Cloud Bailian (DashScope) — OpenAI-compatible endpoint
    dashscope_api_key: str | None = Field(default=None)

    cors_allow_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    confirmation_ttl_seconds: int = Field(default=300, ge=10)
    max_iterations_default: int = Field(default=10, ge=1, le=10000)

    # ---- Knowledge Base ----
    # Default embedding model_ref for newly created KBs. Schemes:
    #   mock:hash-<dim>     — always available, deterministic, dim ∈ {16..2048}
    #   openai:<model>      — needs openai_api_key  (e.g. text-embedding-3-small)
    #   bailian:<model>     — needs dashscope_api_key (e.g. text-embedding-v3)
    # Per-KB override is allowed at create-time; this is just the default the
    # form/Meta-Tool falls back to when the user doesn't pick.
    kb_default_embedding_model_ref: str = Field(default="mock:hash-64")
    # Concurrency cap for the embedding worker (M2 stretch). Currently the
    # ingest path drains synchronously; this hook is for the future async path.
    kb_embedding_batch_size: int = Field(default=64, ge=1, le=512)

    # ---- Skill market (GitHub-backed, default: anthropics/skills) ----
    skill_market_owner: str = Field(default="anthropics")
    skill_market_repo: str = Field(default="skills")
    skill_market_branch: str = Field(default="main")
    skill_market_path_prefix: str = Field(default="skills")
    skill_market_cache_ttl_seconds: int = Field(default=600, ge=0)
    github_token: str | None = Field(
        default=None,
        description="Optional GitHub PAT. Lifts anon 60 req/h rate cap on market listing.",
    )

    def sync_database_url(self) -> str:
        """Synchronous URL for alembic/tools that can't use async driver."""
        return self.database_url.replace("+aiosqlite", "")

    def ensure_data_dir(self) -> None:
        """Ensure ./data exists for sqlite files."""
        for url in (self.database_url, f"sqlite:///{self.checkpoint_db_path}"):
            if "sqlite" in url:
                path = url.split("///", 1)[-1]
                Path(path).parent.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

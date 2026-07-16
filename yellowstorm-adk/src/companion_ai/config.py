"""Orchestrator settings — self-contained so the main Settings class stays clean.

Reads the same environment (ORCHESTRATOR_* / ELECTRIC_* / MCP_TASKS_*). The read
model lives in its own `companion_ai` database on the same instance as
DATABASE_URL (never smartadk); set ORCHESTRATOR_READMODEL_DSN to override.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class OrchestratorSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    ORCHESTRATOR_MAX_CONCURRENCY: int = 4
    ORCHESTRATOR_PLANNER_MODEL: str = "gpt-5.4-mini"

    # Read model (client-facing, synced via ElectricSQL)
    ORCHESTRATOR_READMODEL_DSN: Optional[str] = None   # explicit override
    ORCHESTRATOR_READMODEL_DB: str = "companion_ai"     # else derived from DATABASE_URL
    ORCHESTRATOR_READMODEL_SCHEMA: str = "public"
    # ADK's own session/event tables live in a separate schema so they never
    # collide with the read model (both define a "sessions" table).
    ORCHESTRATOR_ADK_SCHEMA: str = "adk"

    # ElectricSQL (client reads shapes via a trusted proxy that injects the secret)
    ELECTRIC_URL: Optional[str] = None
    ELECTRIC_SECRET: Optional[str] = None

    # Durable long-running MCP task poller
    MCP_TASKS_ENABLED: bool = False
    MCP_TASK_POLL_INTERVAL_S: float = 5.0
    MCP_TASK_CLAIM_TIMEOUT_S: int = 300

    # Only used to derive the read-model DSN when the explicit one is unset.
    DATABASE_URL: Optional[str] = None

    def readmodel_dsn(self) -> str:
        """asyncpg DSN for the read model. Explicit DSN wins; otherwise reuse
        DATABASE_URL's host/creds but swap to the dedicated database, as a plain
        postgresql:// URL (asyncpg doesn't want the SQLAlchemy +driver)."""
        if self.ORCHESTRATOR_READMODEL_DSN:
            return self.ORCHESTRATOR_READMODEL_DSN
        if not self.DATABASE_URL:
            raise ValueError("set ORCHESTRATOR_READMODEL_DSN or DATABASE_URL")
        dsn = self.DATABASE_URL
        for drv in ("+asyncpg", "+psycopg2", "+psycopg"):
            dsn = dsn.replace(drv, "")
        parts = urlsplit(dsn)
        return urlunsplit(parts._replace(path="/" + self.ORCHESTRATOR_READMODEL_DB))

    def session_service_url(self) -> str:
        """SQLAlchemy async URL for ADK's DatabaseSessionService (same DB as the
        read model, but the async +asyncpg driver SQLAlchemy expects)."""
        return self.readmodel_dsn().replace("postgresql://", "postgresql+asyncpg://", 1)


@lru_cache
def get_orchestrator_settings() -> OrchestratorSettings:
    # Load from the same env file the app uses (resolved by ENVIRONMENT), so
    # DATABASE_URL and the ORCHESTRATOR_*/ELECTRIC_*/MCP_* vars are all picked up.
    import os
    from pathlib import Path
    from src.config.settings import ENV_FILES

    env_file = ENV_FILES.get(os.getenv("ENVIRONMENT", "local"))
    if env_file:
        path = str(Path(__file__).resolve().parents[2] / env_file)
        return OrchestratorSettings(_env_file=path)  # type: ignore[call-arg]
    return OrchestratorSettings()

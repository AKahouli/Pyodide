from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Transport/auth are owned by the host server (mcp-pyodide: JWT-only ingress);
    # only the sandbox runtime settings are configured here.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Sandbox manager
    sandbox_manager_url: str = "http://sandbox.yellowsys.org"
    sandbox_manager_token: str = ""
    sandbox_publish_timeout_seconds: float = Field(default=120, ge=1, le=600)
    sandbox_address: str = ""  # dev mode: skip manager, use fixed VM IP

    # Header names to read user_id, conversation_id and workspace paths from each request
    sandbox_user_id_header: str = "x-user-id"
    sandbox_conversation_id_header: str = "x-conversation-id"
    sandbox_execution_id_header: str = "x-execution-id"
    sandbox_workspace_paths_header: str = "x-workspace-paths"
    sandbox_file_paths_header: str = "x-file-paths"
    # Canonical runtime scope headers (remediation §6/§7). Forwarded to the Coordinator.
    sandbox_scope_type_header: str = "x-sandbox-scope-type"
    sandbox_scope_id_header: str = "x-sandbox-scope-id"
    sandbox_lane_id_header: str = "x-sandbox-lane-id"
    sandbox_node_id_header: str = "x-node-id"

    # Lifecycle
    sandbox_ttl_minutes: int = 30
    sandbox_name_prefix: str = "mcp-sandbox"
    # SandboxRuntime — acquisition, probe, and readiness
    sandbox_acquire_max_attempts: int = 3  # Max full acquire cycles (boot + readiness) before SandboxAcquireError
    sandbox_probe_max_attempts: int = 3  # Retries when validating a cached client via echo __probe__
    sandbox_probe_interval_ms: int = 200  # Delay between probe retries on a cached client (milliseconds)
    sandbox_executable_max_attempts: int = 15  # Retries waiting for POST /sandbox/execute after boot
    sandbox_executable_interval_sec: float = 4.0  # Delay between executable checks (seconds) 1m
    sandbox_ready_fail_on_timeout: bool = True  # If True, supervisorctl not ready after 60s raises an error
    sandbox_use_lease_lookup: bool = True  # If True, call GET /sandbox/lease before POST /sandbox/create

    # Optional per-connector instruction override (x-mcp-instructions header)
    mcp_instructions_header: str = "x-mcp-instructions"

    log_level: str = "INFO"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings

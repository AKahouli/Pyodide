"""Runtime configuration sourced from environment variables.

`PORT=8011` is the runtime port (canonical §2). `BACKEND_BASE_URL` defaults
to the in-cluster NestJS URL; `SERVICE_TOKEN` must match
`WORKY_SERVICE_TOKEN` on the backend. The LiteLLM-prefixed variables are
the standard platform contract: provider, model, and keys are resolved by
LiteLLM at call time; the runtime never hardcodes a model id.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    port: int
    backend_base_url: str
    service_token: str
    request_timeout_seconds: float
    adk_version: str
    log_level: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            port=int(os.getenv("PORT", "8011")),
            backend_base_url=os.getenv(
                "BACKEND_BASE_URL", "http://yellowstorm-back:3000"
            ),
            service_token=os.getenv("WORKY_SERVICE_TOKEN", ""),
            request_timeout_seconds=float(os.getenv("REQUEST_TIMEOUT_SECONDS", "15")),
            adk_version=os.getenv("ADK_VERSION", "2.2.0"),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )


def get_settings() -> Settings:
    return Settings.from_env()

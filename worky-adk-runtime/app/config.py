"""Runtime configuration sourced from environment variables.

`PORT=8011` is the runtime port (canonical §2). `BACKEND_BASE_URL` defaults
to the in-cluster NestJS URL; `SERVICE_TOKEN` must match
`WORKY_SERVICE_TOKEN` on the backend. The LiteLLM-prefixed variables are
the standard platform contract: provider, model, and keys are resolved by
LiteLLM at call time; the runtime never hardcodes a model id.

For local dev, a `.env` file in the runtime root is loaded automatically
(override=False: process env wins over .env). In Docker, `env_file: - .env`
in docker-compose.yaml handles it.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _optional_env(name: str) -> str | None:
    """Read an env var, returning None if missing or empty after trim."""
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


@dataclass(frozen=True)
class Settings:
    port: int
    backend_base_url: str
    service_token: str
    request_timeout_seconds: float
    adk_version: str
    log_level: str
    # LiteLLM endpoint. Both are optional; when set they are passed
    # through to ADK's `LiteLlm` as `api_base` and `api_key` kwargs.
    # The model id is NOT env-driven: it is selected per turn by the
    # owner (PromptBar model select) or by the admin default
    # (Models > Set Default), then forwarded to the runtime in the
    # planning-turn / start request body.
    litellm_api_base_url: str | None
    litellm_api_secret_key: str | None

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
            litellm_api_base_url=_optional_env("LITELLM_API_BASE_URL"),
            litellm_api_secret_key=_optional_env("LITELLM_API_SECRET_KEY"),
        )


def get_settings() -> Settings:
    return Settings.from_env()

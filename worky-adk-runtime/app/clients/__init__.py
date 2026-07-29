"""Backend HTTP client (NestJS `/worky/internal/*` callbacks)."""
from .backend_client import (
    EVENT_ID_HEADER,
    SERVICE_TOKEN_HEADER,
    BackendClient,
)

__all__ = ["BackendClient", "SERVICE_TOKEN_HEADER", "EVENT_ID_HEADER"]

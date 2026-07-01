"""gRPC server security configuration — secure by default.

The server requires TLS **and** a shared API key. This module validates that
configuration fail-closed: a missing cert/key or a missing API key raises rather
than silently downgrading to plaintext or open access.

The ONLY way to obtain an insecure (plaintext, unauthenticated) server is the
explicit ``GRPC_ALLOW_INSECURE`` opt-out, intended for local development.

TLS here is server-authentication only (the server presents a certificate). It
is *not* mTLS — the client is not cryptographically authenticated; caller
authentication is handled by the API-key interceptor.
"""

from __future__ import annotations

from pathlib import Path

import grpc
from structlog import get_logger

logger = get_logger(__name__)

# Repo root: src/grpc_server/credentials.py -> parents[2]
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _read_required(path: str | None, var_name: str) -> bytes:
    if not path:
        raise ValueError(
            f"gRPC is secure by default and requires {var_name}. "
            "Set it (and the matching cert/key + GRPC_API_KEY), or set "
            "GRPC_ALLOW_INSECURE=true for local development."
        )
    # Allow relative paths (e.g. "grpc/certs/server.crt") — resolved against the
    # repo root so it works regardless of the process working directory.
    resolved = Path(path)
    if not resolved.is_absolute():
        resolved = _PROJECT_ROOT / resolved
    try:
        with open(resolved, "rb") as f:
            return f.read()
    except OSError as e:
        raise ValueError(f"Cannot read {var_name} at {str(resolved)!r}: {e}") from e


def build_server_credentials(settings) -> grpc.ServerCredentials | None:
    """Return ServerCredentials for the secure default, or ``None`` for the
    explicit insecure opt-out.

    Raises:
        ValueError: when secure mode is active but the cert/key are
            missing/unreadable (fail-closed).
    """
    if settings.GRPC_ALLOW_INSECURE:
        logger.warning(
            "[gRPC] GRPC_ALLOW_INSECURE=true — server is UNENCRYPTED and "
            "UNAUTHENTICATED. Never use this in production."
        )
        return None

    private_key = _read_required(settings.GRPC_TLS_KEY_PATH, "GRPC_TLS_KEY_PATH")
    certificate_chain = _read_required(settings.GRPC_TLS_CERT_PATH, "GRPC_TLS_CERT_PATH")

    # No root_certificates / require_client_auth -> server-auth TLS only (not mTLS).
    return grpc.ssl_server_credentials([(private_key, certificate_chain)])


def resolve_api_key(settings) -> str | None:
    """Return the required API key, or ``None`` under the insecure opt-out.

    Raises:
        ValueError: when secure mode is active but GRPC_API_KEY is unset
            (fail-closed — the server must not start open to any caller).
    """
    if settings.GRPC_ALLOW_INSECURE:
        return None
    if not settings.GRPC_API_KEY:
        raise ValueError(
            "gRPC is secure by default and requires GRPC_API_KEY for caller "
            "authentication. Set it, or set GRPC_ALLOW_INSECURE=true for local "
            "development."
        )
    return settings.GRPC_API_KEY

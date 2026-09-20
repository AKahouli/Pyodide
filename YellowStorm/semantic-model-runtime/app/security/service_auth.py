"""P2.2: private service identity. Fails closed when no key is configured.

The browser never calls this API directly (NestJS is the entry point).
Internal callers present ``X-Semantic-Service-Key``; comparison is
constant-time. No privileged DB/storage credentials are issued here.
"""

from __future__ import annotations

import hmac
import os


def expected_service_key() -> str:
    return os.environ.get("SEMANTIC_RUNTIME_SERVICE_KEY", "")


def is_authorized(presented: str | None) -> bool:
    expected = expected_service_key()
    if not expected or not presented:
        return False
    return hmac.compare_digest(presented, expected)

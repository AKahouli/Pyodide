from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import httpx


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def publisher_jwt(secret: str, model_id: str) -> str:
    header = _b64(b'{"alg":"HS256","typ":"JWT"}')
    claims = _b64(json.dumps({
        "role": "authenticated", "sub": "semantic-model-runtime",
        "model_id": model_id, "exp": int(time.time()) + 60,
    }, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(secret.encode("utf-8"),
                              f"{header}.{claims}".encode("ascii"), hashlib.sha256).digest())
    return f"{header}.{claims}.{signature}"


class RealtimeBroadcastPublisher:
    def __init__(self, *, url: str, tenant: str, jwt_secret: str,
                 timeout_seconds: float = 3.0):
        if not url or not tenant or not jwt_secret:
            raise ValueError("realtime_publisher_not_configured")
        self.url = url.rstrip("/")
        self.tenant = tenant
        self.jwt_secret = jwt_secret
        self.timeout_seconds = timeout_seconds

    async def publish(self, *, model_id: str, event_type: str,
                      payload: dict[str, Any]) -> None:
        token = publisher_jwt(self.jwt_secret, model_id)
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                f"{self.url}/api/broadcast",
                headers={"Authorization": f"Bearer {token}", "Host": self.tenant},
                json={"messages": [{
                    "topic": f"semantic-model:{model_id}", "event": event_type,
                    "payload": payload, "private": True,
                }]},
            )
        response.raise_for_status()

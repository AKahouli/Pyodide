from typing import Any

import httpx

from auth import require_actor_context
from clients.base import BackendError, YellowStormBackendClient
from contracts import PlaybookMcpResultV1, failure_result


class PlaybookBackendError(BackendError):
    def as_result(self) -> PlaybookMcpResultV1:
        return failure_result(
            self.code,
            str(self),
            self.status_code,
            require_actor_context().correlation_id,
            self.details,
        )


class YellowStormPlaybookClient(YellowStormBackendClient):
    def __init__(self, base_url: str, timeout_seconds: float = 190, max_response_bytes: int = 2 * 1024 * 1024, transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__(
            base_url,
            timeout_seconds,
            max_response_bytes,
            transport,
            error_prefix="PLAYBOOK",
            error_type=PlaybookBackendError,
        )

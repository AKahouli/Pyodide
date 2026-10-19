"""Structured errors for sandbox acquisition."""
from __future__ import annotations


class SandboxAcquireError(Exception):
    """Raised when sandbox acquisition fails after all retries."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "ACQUIRE_EXHAUSTED",
        retryable: bool = True,
        attempts: int = 0,
        scope_id: str = "",
        lane_id: str = "",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.attempts = attempts
        self.scope_id = scope_id
        self.lane_id = lane_id

    def format_user_message(self) -> str:
        hint = "Retry sandbox_create." if self.retryable else "Check sandbox manager status."
        return (
            f"Sandbox acquire failed (retryable={str(self.retryable).lower()}, "
            f"code={self.code}, attempts={self.attempts}).\n"
            f"Hint: {hint}\n"
            f"Detail: {self}"
        )

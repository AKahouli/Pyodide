import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class ThoughtActivityUpdate:
    component_id: str
    action: str
    detail: str
    started_at: str


class ThoughtActivityTracker:
    """Reconcile streamed thought deltas with ADK's complete-message snapshots."""

    def __init__(self) -> None:
        self._active_id: str | None = None
        self._active_detail = ""
        self._active_started_at = ""
        self._replay_id: str | None = None
        self._replay_detail = ""
        self._replay_started_at = ""

    def observe(self, text: str, partial: bool | None, observed_at: str) -> ThoughtActivityUpdate | None:
        if not text:
            return None
        if not any(char.isalnum() for char in text) and not (partial is True and self._active_id):
            return None

        if partial is not True:
            candidate_detail = self._active_detail or self._replay_detail
            if candidate_detail and text == candidate_detail:
                return None
            if candidate_detail:
                self._active_id = self._active_id or self._replay_id
                self._active_started_at = self._active_started_at or self._replay_started_at
                self._active_detail = text
                self._remember_active()
                return ThoughtActivityUpdate(
                    component_id=self._active_id,
                    action="update",
                    detail=text,
                    started_at=self._active_started_at,
                )

        if not self._active_id:
            return self._start(text, observed_at)

        self._active_detail += text
        self._remember_active()
        return ThoughtActivityUpdate(
            component_id=self._active_id,
            action="update",
            detail=self._active_detail,
            started_at=self._active_started_at,
        )

    def end_for_visible_text(self) -> None:
        self._active_id = None
        self._active_detail = ""
        self._active_started_at = ""

    def end_for_tool_boundary(self) -> None:
        self.end_for_visible_text()
        self._replay_id = None
        self._replay_detail = ""
        self._replay_started_at = ""

    def _start(self, text: str, observed_at: str) -> ThoughtActivityUpdate:
        self._active_id = f"activity-{uuid.uuid4()}"
        self._active_detail = text
        self._active_started_at = observed_at
        self._remember_active()
        return ThoughtActivityUpdate(
            component_id=self._active_id,
            action="add",
            detail=text,
            started_at=observed_at,
        )

    def _remember_active(self) -> None:
        self._replay_id = self._active_id
        self._replay_detail = self._active_detail
        self._replay_started_at = self._active_started_at

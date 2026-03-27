import asyncio
from typing import Dict, Optional
from datetime import datetime

class DiagramReferenceTracker:
    """Global tracker for diagram references per session with thread safety."""

    def __init__(self):
        self._session_references: Dict[str, int] = {}
        self._stored_diagrams: Dict[str, Dict[int, dict]] = {}
        self._lock = asyncio.Lock()

    async def get_next_reference(self, session_id: str) -> int:
        """Get next sequential diagram reference for a session."""
        async with self._lock:
            if session_id not in self._session_references:
                self._session_references[session_id] = 0

            self._session_references[session_id] += 1
            return self._session_references[session_id]

    async def store_diagram(self, session_id: str, reference: int,
                           html_content: str, diagram_request: str, title: Optional[str] = None):
        """Store diagram data for later retrieval."""
        async with self._lock:
            if session_id not in self._stored_diagrams:
                self._stored_diagrams[session_id] = {}

            self._stored_diagrams[session_id][reference] = {
                "html_content": html_content,
                "diagram_request": diagram_request,
                "title": title,
                "created_at": datetime.utcnow().isoformat(),
                "reference_tag": f"[diagram_{reference}]"
            }

    async def get_diagram(self, session_id: str, reference: int) -> Optional[dict]:
        """Retrieve stored diagram data."""
        async with self._lock:
            return self._stored_diagrams.get(session_id, {}).get(reference)

    async def get_all_session_diagrams(self, session_id: str) -> Dict[int, dict]:
        """Get all diagrams for a session."""
        async with self._lock:
            return self._stored_diagrams.get(session_id, {})

    async def get_diagram_references(self, session_id: str) -> list:
        """Get all diagram references for a session in order."""
        diagrams = await self.get_all_session_diagrams(session_id)
        return [f"[diagram_{ref}]" for ref in sorted(diagrams.keys())]

    async def ensure_session(self, session_id: str):
        """Ensure session exists in reference tracking."""
        async with self._lock:
            if session_id not in self._session_references:
                self._session_references[session_id] = 0
            if session_id not in self._stored_diagrams:
                self._stored_diagrams[session_id] = {}

    def get_session_summary(self, session_id: str) -> dict:
        """Get summary of diagrams for a session."""
        # Note: This method is not async as it's just reading
        # In a real implementation, you might want to add async support
        diagrams = self._stored_diagrams.get(session_id, {})
        return {
            "total_diagrams": len(diagrams),
            "references": [f"[diagram_{ref}]" for ref in sorted(diagrams.keys())],
            "diagrams": {
                ref: data for ref, data in diagrams.items()
            }
        }

_global_diagram_tracker = DiagramReferenceTracker()

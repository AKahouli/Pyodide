from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from .port_payload import PortPayload


class Emission(BaseModel):
    """Canonical output shape produced by any node (action or agent)."""

    ports: Dict[str, List[PortPayload]] = Field(default_factory=dict)
    tool_trace: List[Dict[str, Any]] = Field(default_factory=list)
    llm_prompt_trace: Optional[str] = None
    error: Optional[str] = None

    def to_artifact_list(self) -> List[Dict[str, Any]]:
        """Flatten ports to the legacy artifact list shape expected by the result envelope."""
        artifacts = []
        for port_id, payloads in self.ports.items():
            for payload in payloads:
                d = payload.to_dict()
                d["port_id"] = port_id
                artifacts.append(d)
        return artifacts

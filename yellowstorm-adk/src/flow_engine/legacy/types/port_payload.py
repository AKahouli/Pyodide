from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class ArtifactRef(BaseModel):
    document_id: Optional[str] = None
    workspace_id: Optional[str] = None
    url: Optional[str] = None
    filename: Optional[str] = None
    mime_type: Optional[str] = None


class PortPayload(BaseModel):
    port_id: str
    artifact_kind: Literal["text", "document", "code", "image", "data", "dashboard"] = "text"

    # At most one of these is set, chosen by artifact_kind:
    content: Optional[str] = None          # text | code
    ref: Optional[ArtifactRef] = None      # document | image | dashboard
    data: Optional[Dict[str, Any]] = None  # data (structured JSON)

    metadata: Dict[str, Any] = Field(default_factory=dict)

    # Provenance — stamped by the edge shim, not by the node itself
    source_task_id: Optional[str] = None
    source_port_id: Optional[str] = None
    produced_at: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "PortPayload":
        ref_data = d.get("ref")
        ref = ArtifactRef(**ref_data) if isinstance(ref_data, dict) else None
        return cls(
            port_id=str(d.get("port_id") or d.get("portId") or "default"),
            artifact_kind=str(d.get("artifact_kind") or d.get("artifactKind") or "text"),
            content=d.get("content") or None,
            ref=ref,
            data=d.get("data") if isinstance(d.get("data"), dict) else None,
            metadata=d.get("metadata") if isinstance(d.get("metadata"), dict) else {},
            source_task_id=d.get("source_task_id") or d.get("sourceTaskId") or None,
            source_port_id=d.get("source_port_id") or d.get("sourcePortId") or None,
            produced_at=d.get("produced_at") or d.get("producedAt") or None,
        )

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "port_id": self.port_id,
            "artifact_kind": self.artifact_kind,
            "metadata": dict(self.metadata),
        }
        if self.content is not None:
            result["content"] = self.content
        if self.ref is not None:
            result["ref"] = {k: v for k, v in self.ref.model_dump().items() if v is not None}
        if self.data is not None:
            result["data"] = self.data
        if self.source_task_id:
            result["source_task_id"] = self.source_task_id
        if self.source_port_id:
            result["source_port_id"] = self.source_port_id
        if self.produced_at:
            result["produced_at"] = self.produced_at
        return result


NodeInputs = Dict[str, List[PortPayload]]

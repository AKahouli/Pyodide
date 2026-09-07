from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ResolvedFile(BaseModel):
    """Safe logical file metadata used at cross-capability boundaries."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    path: str = Field(pattern=r"^/workspace/")
    source_kind: Literal["workspace", "attachment", "run"]
    source_alias: str = Field(min_length=1)
    size_bytes: int = Field(ge=0)
    modified_at: str | None = None
    content_type: str | None = None

    @classmethod
    def from_runtime(cls, value: dict) -> "ResolvedFile":
        source = value.get("source")
        if not isinstance(source, dict):
            raise ValueError("resolved file source is required")
        return cls(
            name=value.get("name"),
            path=value.get("path"),
            source_kind=source.get("kind"),
            source_alias=source.get("alias"),
            size_bytes=value.get("sizeBytes"),
            modified_at=value.get("modifiedAt"),
            content_type=value.get("contentType"),
        )

    def to_runtime(self) -> dict:
        return {
            "name": self.name,
            "path": self.path,
            "source": {"kind": self.source_kind, "alias": self.source_alias},
            "sizeBytes": self.size_bytes,
            **({"modifiedAt": self.modified_at} if self.modified_at else {}),
            **({"contentType": self.content_type} if self.content_type else {}),
        }

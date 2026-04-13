from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional


@dataclass
class Part:
    text: Optional[str] = None
    data: Optional[bytes] = None
    mime_type: Optional[str] = None

    @classmethod
    def from_bytes(cls, data: bytes, mime_type: str):
        return cls(data=data, mime_type=mime_type)


@dataclass
class Content:
    role: Optional[str] = None
    parts: List[Part] = field(default_factory=list)


@dataclass
class FunctionResponse:
    name: Optional[str] = None
    response: Any = None

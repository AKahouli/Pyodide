from dataclasses import dataclass, field
from typing import Any, Literal, Optional


@dataclass
class WebSearchCandidate:
    candidate_id: str
    title: str
    url: str
    snippet: Optional[str] = None
    content: Optional[str] = None
    published_at: Optional[str] = None
    author: Optional[str] = None
    connector_id: str = ""
    connector_slug: str = ""
    action_key: str = ""
    provider_metadata: dict[str, Any] = field(default_factory=dict)

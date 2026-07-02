"""SmartRAG - Intelligent Retrieval-Augmented Generation System.

SmartRAG provides two main capabilities:
1. Traditional RAG: Single-agent document search and retrieval
2. Multi-Agent RAG: Team-based agent orchestration for complex tasks

## Quick Start

For traditional RAG chat functionality:
```python
from src.smart_rag.core import ChatRAGService

service = ChatRAGService()
await service.process_chat_request(request, queue)
```

For multi-agent team functionality:
```python
from src.smart_rag.core import AgentTeamService

service = AgentTeamService()
await service.process_team_request(request, queue)
```

## Architecture

- `core/`: Main service entry points for both endpoints
- `engines/`: Processing engines (traditional & multi_agent)
- `agents/`: Agent management (factories, core, generators, tools)
- `tools/`: Tool implementations (search, utilities, infrastructure)
- `messaging/`: Message processing and formatting
- `infrastructure/`: Supporting services and utilities
- `types/`: Type definitions and models

## Endpoints Mapping

- `/chatbots/chatWithADK` -> `core.ChatRAGService` -> `engines.traditional`
- `/agentic/run_agent_team` -> `core.AgentTeamService` -> `engines.multi_agent`
"""

import importlib

__version__ = "1.0.0"
__author__ = "SmartRAG Team"

__all__ = [
    "ChatRAGService",
    "AgentTeamService",
]


def __getattr__(name: str):
    """Lazy-load public exports without breaking submodule attribute access."""
    if name == "ChatRAGService":
        from .core.chat_rag_service import ChatRAGService

        return ChatRAGService
    if name == "AgentTeamService":
        from .core.agent_team_service import AgentTeamService

        return AgentTeamService
    try:
        return importlib.import_module(f".{name}", __name__)
    except ModuleNotFoundError as exc:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from exc

# Core Services

The core module contains the main service entry points for both SmartRAG endpoints.

## Services

### ChatRAGService
**Entry point for traditional RAG functionality**
- **Endpoint**: `/chatbots/chatWithADK`
- **Purpose**: Single-agent document search and retrieval
- **Engine**: `engines.traditional`

### AgentTeamService  
**Entry point for multi-agent team functionality**
- **Endpoint**: `/agentic/run_agent_team`
- **Purpose**: Multi-agent team orchestration for complex tasks
- **Engine**: `engines.multi_agent`

## Usage

These services act as the clean interface between the FastAPI routers and the underlying processing engines.

```python
# Traditional RAG
from src.smart_rag.core import ChatRAGService
service = ChatRAGService()
await service.process_chat_request(request, queue)

# Multi-Agent Team
from src.smart_rag.core import AgentTeamService
service = AgentTeamService()  
await service.process_team_request(request, queue)
```

## Data Flow

```
API Router → Core Service → Processing Engine → Tools → Response
```

Start here to understand how requests flow through the system.
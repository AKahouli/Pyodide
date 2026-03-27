# SmartRAG - Intelligent Retrieval-Augmented Generation System

SmartRAG is a production-ready system that provides both traditional RAG and multi-agent team capabilities for intelligent document processing and question answering.

## 🏗️ Architecture Overview

```
src/smart_rag/
├── 📁 core/                    # 🎯 START HERE - Main service entry points
├── 📁 engines/                 # Processing engines for each endpoint type
├── 📁 agents/                  # Agent management and orchestration
├── 📁 tools/                   # Tool implementations
├── 📁 messaging/               # Message processing and formatting
├── 📁 infrastructure/          # Supporting services and utilities
└── 📁 types/                   # Type definitions and models
```

## 🚀 Quick Navigation

### For New Developers

1. **Start Here**: [`core/`](./core/) - Main service interfaces
2. **Understand Engines**: [`engines/`](./engines/) - Processing logic
3. **Explore Components**: Other directories as needed

### For API Endpoint Understanding

| Endpoint | Service | Engine | Description |
|----------|---------|--------|-------------|
| `/chatbots/chatWithADK` | `core.ChatRAGService` | `engines.traditional` | Single-agent RAG |
| `/agentic/run_agent_team` | `core.AgentTeamService` | `engines.multi_agent` | Multi-agent teams |

## 📁 Directory Guide

### [`core/`](./core/) 🎯
**Main service entry points** - Start here for understanding the system
- `ChatRAGService` - Traditional RAG functionality
- `AgentTeamService` - Multi-agent team functionality

### [`engines/`](./engines/)
**Processing engines** - Core business logic for each endpoint type
- `traditional/` - Single-agent RAG processing
- `multi_agent/` - Multi-agent team orchestration

## 🎯 Usage Examples

### Traditional RAG Chat
```python
from src.smart_rag.core import ChatRAGService

service = ChatRAGService()
await service.process_chat_request(request, queue)
```

### Multi-Agent Team
```python
from src.smart_rag.core import AgentTeamService

service = AgentTeamService()
await service.process_team_request(request, queue)
```

---

**Need Help?** Start with the [`core/`](./core/) directory and follow the imports to understand the data flow.

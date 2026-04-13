"""Core services for SmartRAG functionality.

This module provides the main service entry points for both endpoints:
- ChatRAGService: Traditional RAG chat functionality (/chatbots/chatWithADK)
- AgentTeamService: Multi-agent team functionality (/agentic/run_agent_team)
- SkillsService: Agent skills management and memory (/agentic/config_agents_with_skills)

These services act as the primary interface between the API layer and
the underlying processing engines.
"""

__all__ = [
    'ChatRAGService',
    'AgentTeamService',
    'SkillsService'
]


def __getattr__(name: str):
    if name == 'ChatRAGService':
        from .chat_rag_service import ChatRAGService
        return ChatRAGService
    if name == 'AgentTeamService':
        from .agent_team_service import AgentTeamService
        return AgentTeamService
    if name == 'SkillsService':
        from .skills_service import SkillsService
        return SkillsService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

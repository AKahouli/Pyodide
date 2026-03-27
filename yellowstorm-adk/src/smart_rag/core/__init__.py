"""Core services for SmartRAG functionality.

This module provides the main service entry points for both endpoints:
- ChatRAGService: Traditional RAG chat functionality (/chatbots/chatWithADK)
- AgentTeamService: Multi-agent team functionality (/agentic/run_agent_team)
- SkillsService: Agent skills management and memory (/agentic/config_agents_with_skills)

These services act as the primary interface between the API layer and
the underlying processing engines.
"""

from .chat_rag_service import ChatRAGService
from .agent_team_service import AgentTeamService
from .skills_service import SkillsService

__all__ = [
    'ChatRAGService',
    'AgentTeamService',
    'SkillsService'
]
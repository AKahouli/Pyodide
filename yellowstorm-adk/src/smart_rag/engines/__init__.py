"""Processing engines for SmartRAG functionality.

This module contains the core processing engines:
- traditional: Traditional RAG processing engine
- multi_agent: Multi-agent team processing engine

Each engine contains the specialized logic for handling different types of requests.
"""

# Engines are imported on-demand to avoid circular dependencies
# Import from submodules as needed:
# from .traditional.orchestrator import SmartRAGOrchestrator
# from .multi_agent.workflow_processor import run_agent_team_logic

__all__ = [
    'traditional',
    'multi_agent'
]
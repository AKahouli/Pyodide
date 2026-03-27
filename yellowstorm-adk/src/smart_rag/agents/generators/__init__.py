"""Agent generators module.

This module contains agent suggestion and generation logic:
- suggestions_generator: Agent suggestion generator (formerly agent_suggestions_generator.py)

These components handle the creation and suggestion of agents based on user requirements.
"""

from .suggestions_generator import AgentSuggestionGenerator

__all__ = [
    'AgentSuggestionGenerator'
]
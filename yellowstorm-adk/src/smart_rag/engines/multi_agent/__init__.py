"""Multi-agent processing engine.

This module contains the multi-agent team processing components:
- team_orchestrator: AutoAgentGenerationTeam (formerly team.py)
- workflow_processor: Main workflow logic (formerly workflow_handler.py)
- streaming_processor: Streaming event processing
- config: Configuration and setup

This engine handles complex multi-agent team interactions and orchestration.
"""

# Import on-demand to avoid circular dependencies
# Direct imports are available from submodules:
# from .workflow_processor import run_agent_team_logic
# from .team_orchestrator import AutoAgentGenerationTeam
# from .streaming_processor import StreamingEventProcessor
# from .config import langfuse_client, AgentTeamConfig

__all__ = [
    'workflow_processor',
    'team_orchestrator', 
    'streaming_processor',
    'config'
]
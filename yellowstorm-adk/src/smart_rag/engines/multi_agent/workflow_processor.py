"""Handles the workflow for agent team orchestration.

This includes managing the flow when agents are provided or need to be suggested.

Key Classes:
- AgentTeamOrchestrator: Orchestrates the entire agent team workflow.

Key Functions:
- run_agent_team_logic: Entry point for running the agent team logic.
"""


import asyncio

from src.logger.logging import get_logger
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam
from src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents import handle_no_agents_workflow
from src.smart_rag.engines.multi_agent.agentic_workflows.manual_agents import handle_agents_provided_workflow
from src.smart_rag.engines.multi_agent.agentic_workflows.single_agent import handle_single_agent_workflow
from src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration import initialize_dependencies, create_team, \
    create_team_config
from src.smart_rag.infrastructure.session.execution_lock import (
    PERSISTED_SESSION_APP_NAME,
    session_execution_lock,
)
from src.smart_rag.infrastructure.monitoring.conversation_latency import (
    get_current_conversation_latency_trace,
)


logger = get_logger("api.routers.agentic_rag")

async def run_agent_team_logic(user_request: RunAgentTeamRequest, q: asyncio.Queue[dict]) -> None:
    """Serialize workflows that write the same persisted ADK session."""
    trace = get_current_conversation_latency_trace()
    if trace is not None:
        trace.mark_session_lock_wait_start()

    async with session_execution_lock(
        PERSISTED_SESSION_APP_NAME,
        user_request.user_id,
        user_request.session_id,
    ):
        if trace is not None:
            trace.mark_session_lock_acquired()
        await _run_agent_team_logic(user_request, q)


async def _run_agent_team_logic(user_request: RunAgentTeamRequest, q: asyncio.Queue[dict]) -> None:
    """
    Core logic for running agent teams with full workflow orchestration.

    This is the main entry point for agent team execution. It handles the complete
    workflow from agent suggestion/configuration to execution and response streaming.

    Args:
        user_request (RunAgentTeamRequest): Complete request containing user message,
            agent configurations, manager prompt, and all necessary parameters
        q (asyncio.Queue[dict]): Queue for streaming responses back to the client

    Returns:
        None: Streams responses through the provided queue

    Raises:
        Exception: Any errors during orchestration are logged and sent as error messages
    """
    logger.info(f"[ORCHESTRATOR] Starting agent team orchestration - user_id: {user_request.user_id}, session_id: {user_request.session_id}, agent_mode: {user_request.agent_mode}")

    try:
        logger.info(f"[ORCHESTRATOR] Initializing dependencies - session_id: {user_request.session_id}")
        dependencies = initialize_dependencies()
        config = create_team_config(user_request)
        team = create_team(config, dependencies)
        trace = get_current_conversation_latency_trace()
        if trace is not None:
            trace.mark_orchestration_ready()

        logger.info(f"[ORCHESTRATOR] Team initialized, executing workflow - session_id: {user_request.session_id}")
        await execute_workflow(team, user_request, q)

        logger.info(f"[ORCHESTRATOR] Agent team orchestration completed successfully - session_id: {user_request.session_id}")

    except Exception as e:
        logger.error(f"[ORCHESTRATOR] Error in agent team orchestration - session_id: {user_request.session_id}: {str(e)}")
        await team._message_helper._send_error_message(q, user_request.session_id, str(e))

async def execute_workflow(team: AutoAgentGenerationTeam,
                            user_request: RunAgentTeamRequest, q: asyncio.Queue[dict]) -> None:
    """Execute the appropriate workflow based on request type: agents provided or suggested.
    Args:
        team (AutoAgentGenerationTeam): The agent team instance.
        user_request (RunAgentTeamRequest): The user request containing details.
        q (asyncio.Queue[dict]): The queue for streaming responses.
    Returns:
        None
    """
    logger.info(f"Starting workflow execution - mode: {user_request.agent_mode}, session_id: {user_request.session_id}")
    q.include_tool_results = True
    if user_request.agent_mode=="auto":
        await handle_no_agents_workflow(team, user_request, q)
    elif user_request.agent_mode=="manual":
        await handle_agents_provided_workflow(team, user_request, q)
    elif user_request.agent_mode=="mono":
        await handle_single_agent_workflow(team, user_request, q)
    logger.info(f"Workflow execution completed - mode: {user_request.agent_mode}, session_id: {user_request.session_id}")

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
from src.smart_rag.engines.multi_agent.config import langfuse_client
from src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents import handle_no_agents_workflow
from src.smart_rag.engines.multi_agent.agentic_workflows.manual_agents import handle_agents_provided_workflow
from src.smart_rag.engines.multi_agent.agentic_workflows.single_agent import handle_single_agent_workflow
from src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration import initialize_dependencies, create_team, \
    create_team_config
from src.smart_rag.tools.semantic_search_preflight import run_semantic_search_preflight


logger = get_logger("api.routers.agentic_rag")

async def run_agent_team_logic(user_request: RunAgentTeamRequest, q: asyncio.Queue[dict]) -> None:
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

    await run_semantic_search_preflight(user_request, q)

    # Create main trace for agentic_rag_conversation
    main_trace = langfuse_client.trace(
        session_id=user_request.session_id,
        id=user_request.session_id,
        name="agentic_rag_conversation",
        user_id=user_request.user_id,
        input={
            "user_message": user_request.message,
            "manager_prompt": user_request.manager_prompt,
            "brain_ids": user_request.brain_ids,
            "agents_provided": len(user_request.agents) if user_request.agents else 0,
            "has_brain_documents": bool(user_request.brain_documents),
            "has_brain_relations": bool(user_request.brain_relations)
        },
        metadata={
            "session_id": user_request.session_id,
            "user_id": user_request.user_id,
            "workflow_type": "agent_team_orchestration"
        }
    )

    try:
        logger.info(f"[ORCHESTRATOR] Initializing dependencies - session_id: {user_request.session_id}")
        dependencies = initialize_dependencies()
        config = create_team_config(user_request)
        team = create_team(config, dependencies)

        logger.info(f"[ORCHESTRATOR] Team initialized, executing workflow - session_id: {user_request.session_id}")
        await execute_workflow(team, user_request, q, main_trace)

        # Mark trace as successful
        main_trace.update(output={
            "conversation_completed": True,
            "workflow_successful": True
        })

        logger.info(f"[ORCHESTRATOR] Agent team orchestration completed successfully - session_id: {user_request.session_id}")

        # Explicitly flush to ensure all traces are sent to Langfuse
        try:
            langfuse_client.flush()
        except Exception as e:
            logger.error(f"[ORCHESTRATOR] Failed to flush Langfuse client - session_id: {user_request.session_id}: {str(e)}")

    except Exception as e:
        logger.error(f"[ORCHESTRATOR] Error in agent team orchestration - session_id: {user_request.session_id}: {str(e)}")
        main_trace.update(output={
            "error": str(e),
            "workflow_successful": False
        })
        await team._message_helper._send_error_message(q, user_request.session_id, str(e))

async def execute_workflow(team: AutoAgentGenerationTeam,
                            user_request: RunAgentTeamRequest, q: asyncio.Queue[dict], main_trace) -> None:
    """Execute the appropriate workflow based on request type: agents provided or suggested.
    Args:
        team (AutoAgentGenerationTeam): The agent team instance.
        user_request (RunAgentTeamRequest): The user request containing details.
        q (asyncio.Queue[dict]): The queue for streaming responses.
        main_trace: The main trace for logging.
    Returns:
        None
    """
    logger.info(f"Starting workflow execution - mode: {user_request.agent_mode}, session_id: {user_request.session_id}")
    q.include_tool_results = True
    if user_request.agent_mode=="auto":
        await handle_no_agents_workflow(team, user_request, q, main_trace)
    elif user_request.agent_mode=="manual":
        await handle_agents_provided_workflow(team, user_request, q, main_trace)
    elif user_request.agent_mode=="mono":
        await handle_single_agent_workflow(team, user_request, q, main_trace)
    logger.info(f"Workflow execution completed - mode: {user_request.agent_mode}, session_id: {user_request.session_id}")

"""Route definitions for chatbot interactions."""

import asyncio
from typing import Annotated
from fastapi import APIRouter, status, HTTPException, Depends
from starlette.responses import StreamingResponse
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.middleware.context_binding import bind_from_request_model
from src.middleware.tracing_context import bind_trace_context, create_traced_span
from src.schema.chatbot_schema import (
    ChatWithADKRequest,
    RunAgentTeamRequest,
    RunSingleAgentRequest,
    ConfigAgentsWithSkillsRequest,
    ClearAgentMemoryRequest,
    ChatCompletionRequest,
)
from src.smart_rag.core import ChatRAGService, AgentTeamService, SkillsService
from src.smart_rag.core.single_agent_service import SingleAgentService
from src.smart_rag.core.simple_completion import SimpleCompletionService
from src.smart_rag.infrastructure.memory.memory_service import MemoryService
from src.schema.authentification_schema import User
from src.authentification.get_current_user import get_current_active_user
from src.dependencies import (
    get_chat_rag_service,
    get_agent_team_service,
    get_single_agent_service,
    get_simple_completion_service,
    get_skills_service,
    get_memory_service,
)
from src.routers.sse_stream import event_stream

app_settings = get_settings()
logger = get_logger("api.routers.chatbot")
chatbot_router = APIRouter(prefix="/chatbots", tags=["chatbots"])


@chatbot_router.post(
    "/chat_completion",
    summary="Simple Chat Completion",
    description="""Simple OpenAI chat completion endpoint without RAG or agents.

    - Receives a user message and model name
    - Makes a direct call to OpenAI API
    - Returns the completion response content
    """,
    status_code=status.HTTP_200_OK,
)
async def chat_completion_endpoint(
    user_request: ChatCompletionRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    service: Annotated[SimpleCompletionService, Depends(get_simple_completion_service)],
) -> dict:
    """Endpoint for simple chat completion."""

    try:
        logger.info(
            f"Chat completion request from user {current_user.username} with model {user_request.model}"
        )

        # Create completion
        result = await service.create_completion(
            message=user_request.message,
            model=user_request.model,
            temperature=user_request.temperature,
            max_tokens=user_request.max_tokens,
        )

        return {"status": "success", "content": result}

    except Exception as exc:
        logger.error(f"Unexpected error in chat_completion endpoint: {str(exc)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create chat completion: {str(exc)}",
        ) from exc


@chatbot_router.post(
    "/chatWithADK",
    summary="Chat with ADK",
    description="""This route allows you to chat with the ADK using a prompt. The response will be streamed back as a series of events.""",
    status_code=status.HTTP_200_OK,
)
async def chat_with_adk_endpoint(
    user_request: ChatWithADKRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    service: Annotated[ChatRAGService, Depends(get_chat_rag_service)],
) -> StreamingResponse:
    """Endpoint to chat with ADK and stream the response."""
    # Bind user_id and session_id to logging context
    bind_from_request_model(user_request)

    # Bind trace context for distributed tracing
    bind_trace_context()

    # Trace only request setup; the streaming body runs after the endpoint returns.
    with create_traced_span(
        "chatbot.chat_with_adk",
        resource="POST /chatbots/chatWithADK",
        user_id=user_request.user_id,
        session_id=user_request.session_id,
        chatbot_name=user_request.chatbot_name.get("name", "unknown"),
        vectorstore=user_request.vectorstore_name,
    ):
        logger.info(
            "Request received for /chatWithADK", extra={"user_id": user_request.user_id}
        )

    queue: asyncio.Queue[dict] = asyncio.Queue()
    try:
        bg = asyncio.create_task(service.process_chat_request(user_request, queue))
        return StreamingResponse(
            event_stream(queue, bg, "chatWithADK"),
            media_type="text/event-stream",
        )
    except Exception as e:
        logger.error(f"Unexpected error in chat endpoint - user {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) from e


agentic_router = APIRouter(prefix="/agentic", tags=["agentic_rag"])


@agentic_router.post(
    "/run_agent_team",
    summary="Run Agent Team",
    description="""Run a team of AI agents to handle complex tasks. 

    - If agents list is empty: System will suggest agents and use the first one
    - If agents list is provided : Manager Will use the mentioned agents directly
    """,
    status_code=status.HTTP_200_OK,
)
async def run_agent_team_endpoint(
    user_request: RunAgentTeamRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    service: Annotated[AgentTeamService, Depends(get_agent_team_service)],
) -> StreamingResponse:
    """Endpoint to run agent team and stream the response."""
    # Bind user_id and session_id to logging context
    bind_from_request_model(user_request)

    # Bind trace context for distributed tracing
    bind_trace_context()

    with create_traced_span(
        "agentic.run_agent_team",
        resource="POST /agentic/run_agent_team",
        user_id=user_request.user_id,
        session_id=user_request.session_id,
        agent_mode=user_request.agent_mode,
        num_agents=len(user_request.agents) if user_request.agents else 0,
        num_available_agents=len(user_request.available_agents)
        if user_request.available_agents
        else 0,
        chatbot_name=user_request.chatbot_name.get("name", "unknown"),
        vectorstore=user_request.vectorstore_name,
        search_web=user_request.search_web,
    ):
        logger.info(
            f"[ENDPOINT] Request received for /run_agent_team - agent_mode: {user_request.agent_mode}",
            extra={"user_id": user_request.user_id},
        )

    queue: asyncio.Queue[dict] = asyncio.Queue()
    try:
        bg = asyncio.create_task(service.process_team_request(user_request, queue))
        return StreamingResponse(
            event_stream(queue, bg, "run_agent_team"),
            media_type="text/event-stream",
        )
    except Exception as exc:
        logger.error(
            f"Unexpected error in agent team endpoint - user_id: {user_request.user_id}: {str(exc)}"
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@agentic_router.post(
    "/run_single_agent",
    summary="Run Single Agent",
    description="""Run a single AI agent directly without manager coordination.

    - Executes the provided agent with the user message
    - Streams real-time responses from the agent
    - Supports tools like search, calculator, web search based on agent configuration
    """,
    status_code=status.HTTP_200_OK,
)
async def run_single_agent_endpoint(
    user_request: RunSingleAgentRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    service: Annotated[SingleAgentService, Depends(get_single_agent_service)],
) -> StreamingResponse:
    """Endpoint to run a single agent and stream the response."""

    # Bind user_id and session_id to logging context
    bind_from_request_model(user_request)

    # Bind trace context for distributed tracing
    bind_trace_context()

    with create_traced_span(
        "agentic.run_single_agent",
        resource="POST /agentic/run_single_agent",
        user_id=user_request.user_id,
        session_id=user_request.session_id,
        agent_name=user_request.agent.name if user_request.agent else "unknown",
    ):
        logger.info(
            f"[ENDPOINT] Request received for /run_single_agent",
            extra={
                "user_id": user_request.user_id,
            },
        )

    queue: asyncio.Queue[dict] = asyncio.Queue()
    try:
        bg = asyncio.create_task(service.execute_single_agent(user_request, queue))
        return StreamingResponse(
            event_stream(queue, bg, "run_single_agent"),
            media_type="text/event-stream",
        )
    except Exception as exc:
        logger.error(
            f"Unexpected error in single agent endpoint - user {user_request.user_id}: {str(exc)}"
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@agentic_router.post(
    "/config_agents_with_skills",
    summary="Configure Agent with Skills",
    description="""Configure an agent with specific skills and save to memory.""",
    status_code=status.HTTP_200_OK,
)
async def config_agents_with_skills_endpoint(
    user_request: ConfigAgentsWithSkillsRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    skills_service: Annotated[SkillsService, Depends(get_skills_service)],
) -> dict:
    """Endpoint to configure an agent with skills."""

    try:
        logger.info(f"Configuring agent {user_request.agent.name} with skills")

        # Initialize skills service
        await skills_service.initialize()

        # Save agent skills to memory
        success = await skills_service.save_agent_skills(
            agent_id=user_request.agent.id,
            agent_name=user_request.agent.name,
            skills=user_request.skills,
        )

        if success:
            return {
                "status": "success",
                "message": f"Agent {user_request.agent.name} configured with skills and saved to memory",
                "agent_id": user_request.agent.id,
                "agent_name": user_request.agent.name,
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to save skills to memory for agent {user_request.agent.name}",
            )
    except Exception as exc:
        logger.error(
            f"Unexpected error in config_agents_with_skills endpoint: {str(exc)}"
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@agentic_router.delete(
    "/clear_agent_memory",
    summary="Clear Agent Memory",
    description="""Clear all mem0 memories for a specific agent by agent_id.""",
    status_code=status.HTTP_200_OK,
)
async def clear_agent_memory_endpoint(
    user_request: ClearAgentMemoryRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    memory_service: Annotated[MemoryService, Depends(get_memory_service)],
) -> dict:
    """Endpoint to clear agent memory."""

    try:
        logger.info(f"Clearing memory for agent {user_request.agent_id}")

        # Initialize memory service
        await memory_service.initialize()

        # Clear agent memory
        success = await memory_service.clear_agent_memory(
            agent_id=user_request.agent_id
        )

        if success:
            return {
                "status": "success",
                "message": f"Successfully cleared all memories for agent {user_request.agent_id}",
                "agent_id": user_request.agent_id,
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to clear memories for agent {user_request.agent_id}",
            )
    except Exception as exc:
        logger.exception(f"Unexpected error in clear_agent_memory endpoint: {str(exc)}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# Main router that includes both sub-routers
router = APIRouter()
router.include_router(chatbot_router)
router.include_router(agentic_router)

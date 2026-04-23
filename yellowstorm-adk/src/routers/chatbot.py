"""Route definitions for chatbot interactions."""

import asyncio
import json
import uuid
from typing import Annotated, Dict, Any, List, Optional
from fastapi import APIRouter, status, HTTPException, Depends
from starlette.responses import StreamingResponse
from typing import AsyncGenerator
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.middleware.context_binding import bind_from_request_model
from src.middleware.tracing_context import bind_trace_context, create_traced_span
from src.attribute_extraction.schema.models import (
    AttributeExtractionRequest,
    AttributeExtractionResponse,
)
from src.attribute_extraction.core.webhook_processor import (
    process_extraction_and_webhook,
)
from src.attribute_extraction.schema.batch_models import (
    BatchAttributeExtractionRequest,
    BatchAttributeExtractionResponse,
)
from celery.result import AsyncResult
from src.infrastructure.celery_app import celery_app
from src.attribute_extraction.tasks import process_single_attribute_extraction
from celery import group
from src.schema.chatbot_schema import (
    ChatWithADKRequest,
    RunAgentTeamRequest,
    RunSingleAgentRequest,
    ConfigAgentsWithSkillsRequest,
    ClearAgentMemoryRequest,
    ChatCompletionRequest,
    AgentSuggestion,
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

app_settings = get_settings()
logger = get_logger("api.routers.chatbot")
chatbot_router = APIRouter(prefix="/chatbots", tags=["chatbots"])


async def _event_stream(
    q: asyncio.Queue[dict], bg_task: asyncio.Task, endpoint_name: str, user_id: str
) -> AsyncGenerator[str, None]:
    """Yield events from the queue for streaming responses."""

    first_chunk = True
    try:
        while True:
            chunk = await q.get()
            if chunk is None:
                logger.info(f"Stream finished for {endpoint_name}")
                break
            if first_chunk:
                logger.info(f"First chunk emitted for {endpoint_name}")
                first_chunk = False
            yield f"data: {json.dumps(chunk)}\n\n"
    except asyncio.CancelledError:
        logger.warning("Client disconnected, cancelling background task")
        bg_task.cancel()
        raise


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
            _event_stream(queue, bg, "chatWithADK", user_request.user_id),
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
            _event_stream(queue, bg, "run_agent_team", user_request.user_id),
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
            _event_stream(queue, bg, "run_single_agent", user_request.user_id),
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


def _handle_task_result(task: asyncio.Task) -> None:
    """Handle background task exceptions to prevent silent failures."""
    try:
        task.result()
    except asyncio.CancelledError:
        pass  # Task was cancelled, normal behavior
    except Exception as e:
        logger.error(
            f"Exception in background task {task.get_name()}: {e}", exc_info=True
        )


@agentic_router.post(
    "/attribute_extraction",
    summary="Attribute-Based Value Extraction (Async with Webhook)",
    description="""Extract values from documents based on attribute definitions with type specification.

    This endpoint processes extraction asynchronously and sends results to your webhook URL.
    The extraction query is automatically generated from your attribute definitions.

    Request Format:
    - webhook_url: URL to receive results (required)
    - attributes: {"<attribute>": {"description": "...", "type": "string|number|boolean|array"}}

    Immediate Response:
    ```json
    {
        "job_id": "uuid-string",
        "status": "processing",
        "message": "Extraction job started",
        "webhook_url": "your-webhook-url"
    }
    ```

    Webhook Payload (on success):
    ```json
    {
        "job_id": "uuid-string",
        "event_type": "task_enrichissement",
        "status": "completed",
        "data": {
            "ev_ebitda_moyenne": 21.4,
            "company_name": "VERDOT"
        },
        "brain_ids": ["68dd26e951a377c36ff33bcf"],
        "external_id": "68dd26ea51a377c36ff33be6",
        "sheet_name": "Sheet1"
    }
    ```

    Webhook Payload (on error):
    ```json
    {
        "job_id": "uuid-string",
        "event_type": "task_enrichissement",
        "status": "failed",
        "error": "Error message",
        "external_id": "68dd26ea51a377c36ff33be6",
        "sheet_name": "Sheet1"
    }
    ```
    """,
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AttributeExtractionResponse,
)
async def attribute_extraction_endpoint(
    user_request: AttributeExtractionRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> AttributeExtractionResponse:
    """Endpoint for asynchronous attribute-based value extraction from documents."""

    try:
        # Generate unique job ID
        job_id = str(uuid.uuid4())

        logger.info(
            f"[Job {job_id}] Attribute extraction request from user {current_user.username} for brain_ids: {user_request.brain_ids}"
        )
        logger.info(f"[Job {job_id}] Webhook URL: {user_request.webhook_url}")

        # Start background processing task
        task = asyncio.create_task(
            process_extraction_and_webhook(job_id, user_request, current_user.username),
            name=f"attribute_extraction_{job_id}",
        )
        task.add_done_callback(_handle_task_result)

        # Return immediate response
        return AttributeExtractionResponse(
            job_id=job_id,
            status="processing",
            message=f"Extraction job started. Results will be sent to webhook when complete.",
            webhook_url=str(user_request.webhook_url),
        )

    except Exception as exc:
        logger.error(f"Failed to start extraction job: {str(exc)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to start extraction job: {str(exc)}"
        ) from exc


@agentic_router.post(
    "/batch_attribute_extraction",
    summary="Batch Attribute Extraction (Celery-based)",
    description="""Process multiple attribute extraction requests as a batch using Celery tasks.

    Each request in the batch becomes a separate Celery task for parallel processing.
    Progress can be monitored using the batch_status endpoint.

    Request Format:
    ```json
    {
        "extraction_requests": [
            {
                "brain_ids": ["68dd26e951a377c36ff33bcf"],
                "attributes": {"company_name": {"type": "string", "description": "..."}},
                "webhook_url": "https://your-app.com/webhook"
            },
            {
                "brain_ids": ["68dd26e951a377c36ff33bcf"],
                "attributes": {"revenue": {"type": "number", "description": "..."}},
                "webhook_url": "https://your-app.com/webhook"
            }
        ]
    }
    ```

    Immediate Response:
    ```json
    {
        "batch_job_id": "uuid-string",
        "status": "queued",
        "total_jobs": 2,
        "queued_jobs": 2,
        "message": "Batch job queued for processing"
    }
    ```
    """,
    status_code=status.HTTP_202_ACCEPTED,
    response_model=BatchAttributeExtractionResponse,
)
async def batch_attribute_extraction_endpoint(
    batch_request: BatchAttributeExtractionRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> BatchAttributeExtractionResponse:
    """Endpoint for batch attribute extraction using Celery group."""

    try:
        # Generate unique batch job ID
        batch_job_id = str(uuid.uuid4())

        logger.info(
            f"[Batch {batch_job_id}] Batch extraction request from user {current_user.username}"
        )
        logger.info(
            f"[Batch {batch_job_id}] Total jobs: {len(batch_request.extraction_requests)}"
        )

        # Create Celery group of individual tasks
        tasks = []
        for i, request in enumerate(batch_request.extraction_requests):
            job_id = f"{batch_job_id}_{i}"

            # Convert request to dict format (serializable for Celery)
            request_dict = request.model_dump()
            # Convert HttpUrl to string for JSON serialization
            if (
                "webhook_url" in request_dict
                and request_dict["webhook_url"] is not None
            ):
                request_dict["webhook_url"] = str(request_dict["webhook_url"])
            request_dict["username"] = current_user.username  # Add username for context

            # Create individual task
            task = process_single_attribute_extraction.s(
                job_id, request_dict, current_user.username
            ).set(queue="attribute_extraction")
            tasks.append(task)

        # Launch group of tasks
        job_group = group(*tasks)
        group_result = job_group.apply_async()

        logger.info(
            f"[Batch {batch_job_id}] Launched Celery group: {group_result.id} with {len(tasks)} tasks"
        )

        # Store group result ID for status tracking
        # You can use Redis or database to persist this mapping if needed
        # For now, the group_result.id can be used for tracking

        # Return immediate response
        return BatchAttributeExtractionResponse(
            batch_job_id=batch_job_id,
            status="queued",
            total_jobs=len(batch_request.extraction_requests),
            queued_jobs=len(batch_request.extraction_requests),
            message=f"Batch group launched. Each task will send results to its webhook URL when complete.",
        )

    except Exception as exc:
        logger.error(f"Failed to launch batch group: {str(exc)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to launch batch group: {str(exc)}",
        ) from exc


@agentic_router.get(
    "/batch_status/{batch_job_id}",
    summary="Check Batch Processing Status",
    description="""Monitor the progress of a batch attribute extraction job.

    Returns the current status of the batch job and individual task statuses.
    """,
    response_model=dict,
)
async def get_batch_status(batch_job_id: str):
    """Get the status of a batch processing job."""

    try:
        # Get batch task result from Celery
        batch_task = AsyncResult(batch_job_id, app=celery_app)

        if batch_task.state == "PENDING":
            return {
                "batch_job_id": batch_job_id,
                "status": "pending",
                "message": "Batch job is pending execution",
            }
        elif batch_task.state == "PROGRESS":
            result = batch_task.info
            return {
                "batch_job_id": batch_job_id,
                "status": "processing",
                "progress": result.get("progress", 0),
                "message": result.get("status", "Processing"),
                "total_jobs": result.get("total_jobs", 0),
                "completed_jobs": result.get("completed_jobs", 0),
            }
        elif batch_task.state == "SUCCESS":
            result = batch_task.get()
            return result
        elif batch_task.state == "FAILURE":
            return {
                "batch_job_id": batch_job_id,
                "status": "failed",
                "error": str(batch_task.info),
            }
        else:
            return {
                "batch_job_id": batch_job_id,
                "status": batch_task.state,
                "message": f"Task in state: {batch_task.state}",
            }

    except Exception as exc:
        logger.error(f"Failed to get batch status for {batch_job_id}: {str(exc)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get batch status: {str(exc)}",
        ) from exc


# Main router that includes both sub-routers
router = APIRouter()
router.include_router(chatbot_router)
router.include_router(agentic_router)

"""Route definitions for playbook_dir step execution."""

import asyncio
import json
from typing import Annotated, AsyncGenerator
from fastapi import APIRouter, status, HTTPException, Depends
from starlette.responses import StreamingResponse
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.playbook import RunPlaybookStepRequest, RunPlaybookStepResponse, RunPlaybookRequest, RunPlaybookResponse
from src.schema.authentification_schema import User
from src.authentification.get_current_user import get_current_active_user
from src.smart_rag.playbook_dir.execute_step import execute_playbook_step
from src.smart_rag.playbook_dir.run_playbook import execute_playbook_with_agent_team

app_settings = get_settings()
logger = get_logger("api.routers.playbook")
playbook_router = APIRouter(prefix="/playbook", tags=["playbook"])


async def _event_stream(q: asyncio.Queue[dict], bg_task: asyncio.Task, endpoint_name: str) -> AsyncGenerator[str, None]:
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


@playbook_router.post(
    "/execute_playbook_step",
    status_code=status.HTTP_200_OK,
    response_model=RunPlaybookStepResponse
)
async def execute_playbook_step_endpoint(
    request: RunPlaybookStepRequest,
    user: Annotated[User, Depends(get_current_active_user)]
) -> RunPlaybookStepResponse:
    """
    Execute a playbook step with the provided configuration.

    Args:
        request: The playbook_dir step execution request containing:
            - call_id: Original session ID to retrieve events from
            - messageId: New session ID (optional)
            - taskId: ID of the task/step to re-execute
            - taskDescription: New description for the step
            - order: Order number of the step in the playbook
            - agent: Complete agent configuration
            - manager_agent: Manager agent configuration
        user: The authenticated user making the request

    Returns:
        RunPlaybookStepResponse: The result of the playbook step execution
    """
    logger.info(
        f"[PLAYBOOK ROUTER] Executing playbook_dir step - "
        f"TaskId: {request.taskId}, "
        f"MessageId: {request.messageId}, "
        f"CallId: {request.call_id}, "
        f"Order: {request.order}, "
        f"Agent: {request.agent.name}"
    )

    queue: asyncio.Queue[dict] = asyncio.Queue()
    try:
        bg = asyncio.create_task(execute_playbook_step(request, queue))

        return StreamingResponse(
            _event_stream(queue, bg, "execute_playbook_step"),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )
    except Exception as e:
        logger.error(f"Unexpected error in playbook endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@playbook_router.post(
    "/execute_playbook",
    status_code=status.HTTP_200_OK,
    response_model=RunPlaybookResponse
)
async def execute_playbook_endpoint(
    request: RunPlaybookRequest,
    user: Annotated[User, Depends(get_current_active_user)]
) -> RunPlaybookResponse:
    """
    Execute a complete playbook with multiple steps using agent team logic.

    Args:
        request: The playbook execution request containing:
            - playbook_id: Unique identifier for the playbook
            - playbook_name: Name of the playbook
            - message: User query
            - steps: List of RunPlaybookStepRequest to execute in order
            - manager_agent: Manager agent configuration
        user: The authenticated user making the request

    Returns:
        StreamingResponse: Streaming response with playbook execution events
    """
    logger.info(
        f"[PLAYBOOK ROUTER] Executing playbook - "
        f"PlaybookId: {request.playbook_id}, "
        f"PlaybookName: {request.playbook_name}, "
        f"Total steps: {len(request.steps)}"
    )

    queue: asyncio.Queue[dict] = asyncio.Queue()

    try:
        # Create background task for playbook execution
        bg = asyncio.create_task(execute_playbook_with_agent_team(request, queue))

        return StreamingResponse(
            _event_stream(queue, bg, "execute_playbook"),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )

    except Exception as e:
        logger.error(f"Unexpected error in execute_playbook endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) from e

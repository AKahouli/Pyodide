import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from starlette.responses import StreamingResponse

from src.authentification.get_current_user import get_current_active_user
from src.logger.logging import get_logger
from src.schema.authentification_schema import User
from src.schema.evaluator import RunADKEvalRequest
from src.evaluation.agent_evaluator import run_adk_evaluation_streaming

logger = get_logger("api.routers.evaluation_batch")

router = APIRouter(
    prefix="/evaluation-batch",
    tags=["evaluation-batch"],
)

# The backend authenticated the end user; it names them on this header. The service key alone
# never identifies an actor, and the browser never chooses one.
TRUSTED_ACTOR_HEADER = "x-yellowstorm-user-id"
MAX_ACTOR_ID_LENGTH = 200


async def require_trusted_evaluation_actor(
    x_yellowstorm_user_id: Annotated[str | None, Header()] = None,
) -> str:
    """Runs only after the x-api-key check: a valid service key without an acting user is a
    caller bug, not an anonymous evaluation."""
    actor = (x_yellowstorm_user_id or "").strip()
    if not actor or len(actor) > MAX_ACTOR_ID_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="missing_trusted_actor",
        )
    return actor


@router.post("/execute_agent_evaluator")
async def execute_adk_evaluator_endpoint(
    request: RunADKEvalRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    actor_user_id: Annotated[str, Depends(require_trusted_evaluation_actor)],
):
    """
    Endpoint to execute evaluation of an ADK agent with SSE streaming, for one authenticated
    acting user. The body's own ``user_id`` must agree with the trusted header, so a caller
    cannot run someone else's evaluation by renaming it.
    """
    if request.user_id != actor_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="actor_mismatch",
        )
    logger.info(f"Requête d'évaluation streaming reçue pour l'agent: {request.agent.name}")

    q = asyncio.Queue()

    # Lancer l'évaluation en tâche de fond (after authorization: dependencies ran first).
    bg_task = asyncio.create_task(run_adk_evaluation_streaming(request, q))

    async def event_generator():
        try:
            while True:
                chunk = await q.get()
                if chunk is None:
                    break
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            logger.error(f"Erreur dans le générateur d'événements SSE: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # A disconnected stream cancels its evaluation; results already sent are its own.
            if not bg_task.done():
                bg_task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

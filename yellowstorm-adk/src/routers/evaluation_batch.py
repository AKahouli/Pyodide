import uuid
import asyncio
from typing import Annotated, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks

from starlette.responses import StreamingResponse
import json

from src.authentification.get_current_user import get_current_active_user, get_current_active_user_optional
from src.logger.logging import get_logger
from src.schema.authentification_schema import User
from src.schema.evaluator import RunADKEvalRequest # New schema
from src.schema.evaluation_schema import EvaluationBatchRequest, EvaluationBatchResponse # Old schemas still used
from src.evaluation.agent_evaluator import run_adk_evaluation_streaming # New evaluator
from src.evaluation.batch_evaluator import BatchEvaluator # Old evaluator

logger = get_logger("api.routers.evaluation_batch")

router = APIRouter(
    prefix="/evaluation-batch",
    tags=["evaluation-batch"],
)

# In-memory store for evaluation results (for POC polling)
# In production, this would be a database (Mongoose/MongoDB)
evaluations_store: Dict[str, Dict[str, Any]] = {}

async def _background_evaluation(evaluation_id: str, request: EvaluationBatchRequest, user_id: str):
    """Background task to run the batch evaluation."""
    try:
        evaluator = BatchEvaluator()
        
        async def on_progress(iteration_result):
            evaluations_store[evaluation_id]["results"].append(iteration_result.model_dump())
            evaluations_store[evaluation_id]["completed_runs"] += 1
            logger.info(f"Progress for {evaluation_id}: {evaluations_store[evaluation_id]['completed_runs']}/{evaluations_store[evaluation_id]['total_runs']}")

        results = await evaluator.run_batch_evaluation(request, user_id, on_progress=on_progress)
        
        evaluations_store[evaluation_id]["status"] = "completed"
    except Exception as e:
        logger.error(f"Error in background evaluation {evaluation_id}: {str(e)}")
        evaluations_store[evaluation_id]["status"] = "failed"
        evaluations_store[evaluation_id]["error"] = str(e)

@router.post("/launch", response_model=EvaluationBatchResponse)
async def launch_batch_evaluation(
    request: EvaluationBatchRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    """Launch a batch evaluation task."""
    try:
        evaluation_id = str(uuid.uuid4())
        
        # Initialize store
        evaluations_store[evaluation_id] = {
            "status": "processing",
            "results": [],
            "total_runs": request.num_runs,
            "completed_runs": 0,
            "agent_id": request.agent_id,
            "scenario_name": request.scenario_name
        }
        
        # Add to background tasks
        background_tasks.add_task(_background_evaluation, evaluation_id, request, current_user.username)
        
        return EvaluationBatchResponse(
            evaluation_id=evaluation_id,
            status="queued"
        )
    except Exception as exc:
        logger.exception(f"Failed to launch batch evaluation: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc)
        )

@router.get("/status/{evaluation_id}")
async def get_evaluation_status(
    evaluation_id: str,
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    """Get the status and results of an evaluation."""
    if evaluation_id not in evaluations_store:
        raise HTTPException(status_code=404, detail="Evaluation not found")
        
    return evaluations_store[evaluation_id]

@router.delete("/{evaluation_id}")
async def delete_evaluation(
    evaluation_id: str,
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    """Delete an evaluation from the store."""
    if evaluation_id in evaluations_store:
        del evaluations_store[evaluation_id]
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Evaluation not found")

@router.post("/execute_agent_evaluator")
async def execute_adk_evaluator_endpoint(
    request: RunADKEvalRequest, 
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user_optional)
):
    """
    Endpoint to execute evaluation of an ADK agent with SSE streaming.
    """
    logger.info(f"Requête d'évaluation streaming reçue pour l'agent: {request.agent.name}")
    
    q = asyncio.Queue()
    
    # Lancer l'évaluation en tâche de fond
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
            if not bg_task.done():
                bg_task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

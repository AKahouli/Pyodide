import uuid
import asyncio
from typing import Annotated, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks

from starlette.responses import StreamingResponse
import json

from src.authentification.get_current_user import get_current_active_user, get_current_active_user_optional, get_current_user_optional
from src.logger.logging import get_logger
from src.schema.authentification_schema import User
from src.schema.evaluator import RunADKEvalRequest # New schema
from src.schema.evaluation_schema import EvaluationBatchRequest, EvaluationBatchResponse # Old schemas still used
from src.evaluation.agent_evaluator import run_adk_evaluation_streaming # New evaluator
from src.evaluation.batch_evaluator import BatchEvaluator # Refactored evaluator

logger = get_logger("api.routers.evaluation_batch")

router = APIRouter(
    prefix="/evaluation-batch",
    tags=["evaluation-batch"],
)

# In-memory store for evaluation results (for POC polling)
# In production, this would be a database (Mongoose/MongoDB)
evaluations_store: Dict[str, Dict[str, Any]] = {}

# Shared BatchEvaluator instance
_batch_evaluator = BatchEvaluator()


async def _background_evaluation(evaluation_id: str, request: EvaluationBatchRequest, user_id: str):
    """Background task to run the batch evaluation using the real ADK pipeline."""
    try:
        # Resolve judge_model
        judge_model = None
        if request.judge_model:
            judge_model = request.judge_model

        async def on_progress(event):
            """Callback for progress updates from the evaluation pipeline."""
            event_type = event.get("type", "")
            if event_type == "progress" and "test_case" in event:
                # Append the individual test result
                evaluations_store[evaluation_id]["results"].append(event["test_case"])
                evaluations_store[evaluation_id]["completed_runs"] = len(evaluations_store[evaluation_id]["results"])
                logger.info(f"Progress for {evaluation_id}: {evaluations_store[evaluation_id]['completed_runs']} test cases completed")

        result = await _batch_evaluator.run_evaluation(
            agent_config=request.agent_config.model_dump(),
            dataset=[{"question": item.question, "reference_answer": item.reference_answer} for item in request.dataset],
            num_runs=request.num_runs,
            mode=request.mode,
            judge_model=judge_model,
            threshold=0.7,
            user_id=user_id,
            on_progress=on_progress,
        )

        # Update store with final results
        evaluations_store[evaluation_id]["status"] = result.get("status", "completed")
        evaluations_store[evaluation_id]["results"] = result.get("results", [])
        evaluations_store[evaluation_id]["summary"] = result.get("summary")
        evaluations_store[evaluation_id]["score"] = result.get("score", 0)
        evaluations_store[evaluation_id]["total_tests"] = result.get("total_tests", 0)
        evaluations_store[evaluation_id]["error"] = result.get("error")
        
        logger.info(f"Evaluation {evaluation_id} completed with status: {result.get('status')}")
    except Exception as e:
        import traceback
        logger.error(f"Error in background evaluation {evaluation_id}: {str(e)}")
        logger.error(traceback.format_exc())
        evaluations_store[evaluation_id]["status"] = "failed"
        evaluations_store[evaluation_id]["error"] = str(e)


@router.post("/launch", response_model=EvaluationBatchResponse)
async def launch_batch_evaluation(
    request: EvaluationBatchRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_active_user_optional)],
):
    """Launch a batch evaluation task."""
    try:
        evaluation_id = str(uuid.uuid4())
        
        # Initialize store
        evaluations_store[evaluation_id] = {
            "status": "processing",
            "results": [],
            "numRuns": request.num_runs,
            "completed_runs": 0,
            "agent_id": request.agent_id,
            "scenario_name": request.scenario_name
        }
        
        # Add to background tasks
        user_id = current_user.username if current_user else "anonymous"
        background_tasks.add_task(_background_evaluation, evaluation_id, request, user_id)
        
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
    current_user: Annotated[User, Depends(get_current_active_user_optional)],
):
    """Get the status and results of an evaluation."""
    if evaluation_id not in evaluations_store:
        raise HTTPException(status_code=404, detail="Evaluation not found")
        
    return evaluations_store[evaluation_id]

@router.delete("/{evaluation_id}")
async def delete_evaluation(
    evaluation_id: str,
    current_user: Annotated[User, Depends(get_current_active_user_optional)],
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

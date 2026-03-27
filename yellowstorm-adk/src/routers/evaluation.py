from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from src.authentification.get_current_user import get_current_active_user
from src.evaluation.semantic_match import evaluate_semantic_match
from src.logger.logging import get_logger
from src.schema.authentification_schema import User
from src.schema.evaluation_schema import SemanticMatchRequest, SemanticMatchResponse

logger = get_logger("api.routers.evaluation")

router = APIRouter(
    prefix="/evaluation",
    tags=["evaluation"],
)


@router.post("/semantic-match", response_model=SemanticMatchResponse)
async def semantic_match_route(
    request: SemanticMatchRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    try:
        result = await evaluate_semantic_match(
            baseline_output=request.baseline_output,
            current_output=request.current_output,
            user_id=current_user.username,
            task_title=request.task_title or "",
            task_description=request.task_description or "",
            baseline_tool_summaries=request.baseline_tool_summaries,
            current_tool_summaries=request.current_tool_summaries,
        )
        if result is None:
            raise ValueError("Semantic evaluation requires both baseline and current output")

        return SemanticMatchResponse(
            match_score=result["match_score"],
            semantic_similarity_score=result["semantic_similarity_score"],
            evidence_consistency_score=result["evidence_consistency_score"],
            judge_score=result["judge_score"],
            reason=result["reason"],
            missing_points=result["missing_points"],
            changed_points=result["changed_points"],
            model=result["model"],
            judge_used=result["judge_used"],
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Unexpected semantic evaluation error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "SEMANTIC_EVALUATION_FAILED",
                "message": "Semantic evaluation failed",
                "details": {"error": str(exc)},
            },
        ) from exc

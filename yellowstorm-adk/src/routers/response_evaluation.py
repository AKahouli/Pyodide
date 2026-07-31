from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from src.authentification.get_current_user import get_current_active_user
from src.evaluation.response_reliability_evaluator import ResponseReliabilityEvaluator
from src.schema.authentification_schema import User
from src.schema.response_reliability import (
    ResponseReliabilityRequest,
    ResponseReliabilityResponse,
)

router = APIRouter(prefix="/response-evaluation", tags=["response-evaluation"])


@lru_cache()
def get_response_reliability_evaluator() -> ResponseReliabilityEvaluator:
    return ResponseReliabilityEvaluator()


@router.post("/evaluate", response_model=ResponseReliabilityResponse)
async def evaluate_response_reliability(
    request: ResponseReliabilityRequest,
    _current_user: Annotated[User, Depends(get_current_active_user)],
    evaluator: Annotated[ResponseReliabilityEvaluator, Depends(get_response_reliability_evaluator)],
) -> ResponseReliabilityResponse:
    try:
        return await evaluator.evaluate(request)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The reliability evaluator returned an invalid response",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The reliability evaluator is unavailable",
        ) from exc

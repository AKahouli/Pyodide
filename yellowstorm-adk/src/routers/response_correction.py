from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from src.authentification.get_current_user import get_current_active_user
from src.evaluation.response_corrector import InvalidCorrectionResponse, ResponseCorrector
from src.logger.logging import get_logger
from src.schema.authentification_schema import User
from src.schema.response_correction import ResponseCorrectionRequest, ResponseCorrectionResponse

router = APIRouter(prefix="/response-evaluation", tags=["response-evaluation"])
logger = get_logger("api.evaluation.response_corrector")


@lru_cache()
def get_response_corrector() -> ResponseCorrector:
    return ResponseCorrector()


@router.post("/correct", response_model=ResponseCorrectionResponse)
async def correct_response(
    request: ResponseCorrectionRequest,
    _current_user: Annotated[User, Depends(get_current_active_user)],
    corrector: Annotated[ResponseCorrector, Depends(get_response_corrector)],
) -> ResponseCorrectionResponse:
    try:
        return await corrector.correct(request)
    except InvalidCorrectionResponse as exc:
        logger.warning(
            "Response corrector returned invalid output",
            request_id=request.requestId,
            message_id=request.messageId,
            validation_category=exc.category,
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="The response corrector returned an invalid response") from exc
    except Exception as exc:
        logger.exception(
            "Response corrector unavailable",
            request_id=request.requestId,
            message_id=request.messageId,
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="The response corrector is unavailable") from exc

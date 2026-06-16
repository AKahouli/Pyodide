from fastapi import APIRouter

from src.logger.logging import get_logger

logger = get_logger("api.auth")

router = APIRouter(
    tags=["authentication"],
)

from typing import Annotated, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.authentification_schema import User

logger = get_logger(__name__)
app_settings = get_settings()

api_key_header = APIKeyHeader(name="x-api-key", auto_error=False)
api_key_header_optional = APIKeyHeader(name="x-api-key", auto_error=False)


def _expected_api_key() -> str:
    key = getattr(app_settings, "ADK_API_KEY", "") or ""
    return key.strip()


def _service_user() -> User:
    return User(username="service", disabled=False)


def get_current_user(
    x_api_key: Annotated[Optional[str], Depends(api_key_header)] = None,
) -> User:
    expected = _expected_api_key()
    if not expected:
        logger.error("ADK_API_KEY is not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API key authentication not configured",
        )
    if not x_api_key or x_api_key.strip() != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return _service_user()


def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


def get_current_user_optional(
    x_api_key: Annotated[Optional[str], Depends(api_key_header_optional)] = None,
) -> User:
    expected = _expected_api_key()
    if not x_api_key:
        return User(username="anonymous", disabled=False)
    if not expected or x_api_key.strip() != expected:
        return User(username="anonymous", disabled=False)
    return _service_user()


def get_current_active_user_optional(
    current_user: Annotated[User, Depends(get_current_user_optional)],
) -> User:
    return current_user

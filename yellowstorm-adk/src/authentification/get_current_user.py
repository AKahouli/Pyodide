from typing import Annotated, AsyncGenerator, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader
from structlog.contextvars import bind_contextvars, unbind_contextvars

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.middleware.correlation import user_ctx
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


async def get_current_user(
    request: Request,
    x_api_key: Annotated[Optional[str], Depends(api_key_header)] = None,
) -> AsyncGenerator[User, None]:
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
    # Trusted-identity re-binding (plan P05): the acting user is bound only here —
    # after the API key validates. The caller (backend) authenticated the end user
    # and vouches for them via the `user` header; unauthenticated paths bind nothing.
    # MUST be an async generator: sync generator deps run via run_in_threadpool in a
    # COPY of the request context, so their contextvar bindings never reach the
    # endpoint. set(None) instead of reset(): teardown runs in a different context.
    username = request.headers.get("user")
    user_ctx.set(username or None)
    bind_contextvars(username=username or "")
    try:
        yield _service_user()
    finally:
        user_ctx.set(None)
        unbind_contextvars("username")


def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


async def get_current_user_optional(
    request: Request,
    x_api_key: Annotated[Optional[str], Depends(api_key_header_optional)] = None,
) -> AsyncGenerator[User, None]:
    expected = _expected_api_key()
    if not x_api_key:
        yield User(username="anonymous", disabled=False)
        return
    if not expected or x_api_key.strip() != expected:
        yield User(username="anonymous", disabled=False)
        return
    username = request.headers.get("user")
    user_ctx.set(username or None)
    bind_contextvars(username=username or "")
    try:
        yield _service_user()
    finally:
        user_ctx.set(None)
        unbind_contextvars("username")


def get_current_active_user_optional(
    current_user: Annotated[User, Depends(get_current_user_optional)],
) -> User:
    return current_user

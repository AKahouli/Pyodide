"""
Context binding utilities for enriching logs with request-specific data.

This module provides utilities to bind user_id and session_id from request models
to the structlog context, ensuring all logs generated during request processing
contain these fields.
"""

from typing import Optional, Union

import structlog

from src.schema.chatbot_schema import (
    ChatWithADKRequest,
    RunAgentTeamRequest,
    RunSingleAgentRequest,
)


def bind_user_session_context(
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> None:
    """
    Bind user_id and session_id to structlog context.

    This ensures all logs generated during request processing contain these fields.

    Args:
        user_id: User identifier
        session_id: Session identifier
    """
    bind_dict = {}

    if user_id:
        bind_dict['user_id'] = user_id
    if session_id:
        bind_dict['session_id'] = session_id

    if bind_dict:
        structlog.contextvars.bind_contextvars(**bind_dict)


def bind_from_request_model(
    request_model: Union[ChatWithADKRequest, RunAgentTeamRequest, RunSingleAgentRequest]
) -> None:
    """
    Extract user_id and session_id from request model and bind to context.

    Args:
        request_model: The Pydantic request model containing user_id and session_id

    Example:
        ```python
        @app.post("/endpoint")
        async def endpoint(request: ChatWithADKRequest):
            bind_from_request_model(request)
            # All subsequent logs will have user_id and session_id
            logger.info("Processing request")
        ```
    """
    try:
        user_id = getattr(request_model, 'user_id', None)
        session_id = getattr(request_model, 'session_id', None)
        bind_user_session_context(user_id=user_id, session_id=session_id)
    except Exception as e:
        # Don't let context binding errors break the request
        logger = structlog.get_logger("api.middleware.context_binding")
        logger.warning(f"Failed to bind request context: {e}")
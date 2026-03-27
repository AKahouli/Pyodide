import asyncio

from fastapi import FastAPI, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
from opentelemetry import trace
from opentelemetry.trace import Span

from .correlation import CorrelationIdMiddleware

from .cors import add_cors
from .logging import add_logging
from .tracing import add_tracing
from ..config.settings import Settings

from src.config.settings import get_settings
app_settings = get_settings()



def add_middleware(app: FastAPI, app_settings: Settings) -> None:
    """
    add middleware to fastapi application
    Args:
        app: FastAPI application.
        app_settings: settings of the application

    """
    add_cors(app)
    # Always enable CorrelationIdMiddleware (user/correlation ID capture)
    app.add_middleware(CorrelationIdMiddleware)

    if not app_settings.APPLICATION_INSIGHTS_LOG:
        add_logging(app)
        # the trancing is changing the correlation id !
        add_tracing(app)
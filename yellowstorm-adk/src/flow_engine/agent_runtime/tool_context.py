import contextvars
from typing import Optional


last_mcp_actual_args: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "last_mcp_actual_args", default=None
)

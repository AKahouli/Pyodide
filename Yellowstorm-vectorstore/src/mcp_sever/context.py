"""
MCP request context management.

Provides context variables for passing request-scoped data
(such as brain_ids from HTTP headers) through the async call stack
without modifying tool function signatures.
"""

from contextvars import ContextVar
from typing import Optional, List

brain_ids_var: ContextVar[Optional[List[str]]] = ContextVar('brain_ids', default=None)
external_ids_var: ContextVar[Optional[List[str]]] = ContextVar('external_ids', default=None)

def parse_brain_ids_header(brain_id_header: Optional[str]) -> Optional[List[str]]:
    """Parse X-Brain-ID header into a normalized list of brain IDs."""
    if not brain_id_header:
        return None

    brain_ids = [brain_id.strip() for brain_id in brain_id_header.split(",") if brain_id.strip()]
    return brain_ids or None


def parse_external_ids_header(external_id_header: Optional[str]) -> Optional[List[str]]:
    """Parse X-External-ID header into a normalized list of external IDs."""
    if not external_id_header:
        return None

    external_ids = [eid.strip() for eid in external_id_header.split(",") if eid.strip()]
    return external_ids or None

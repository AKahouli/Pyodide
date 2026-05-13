"""OpenTelemetry tracing for flow engine spans."""

from __future__ import annotations

from typing import Any, Optional

from structlog import get_logger

logger = get_logger(__name__)


async def start_execution_span(
    execution_id: str,
    flow_id: str,
    attributes: Optional[dict[str, str]] = None,
) -> Any:
    logger.info("[tracing] Starting execution span", execution_id=execution_id, flow_id=flow_id)
    return {"execution_id": execution_id, "flow_id": flow_id}


async def start_node_span(
    parent_span: Any,
    node_id: str,
    iteration: int,
    node_kind: str,
) -> Any:
    logger.info("[tracing] Starting node span", node_id=node_id, iteration=iteration, kind=node_kind)
    return {"node_id": node_id, "iteration": iteration}

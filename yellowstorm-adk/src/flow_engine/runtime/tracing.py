"""OpenTelemetry tracing for flow engine spans.

Emits per-execution and per-node spans.  Best-effort: if no OTel
collector is available, logs a warning and returns a no-op span.
"""

from __future__ import annotations

from typing import Any, Optional

from structlog import get_logger

logger = get_logger(__name__)

_tracer: Any = None
_tracer_available: bool | None = None


def _get_tracer() -> Any | None:
    global _tracer, _tracer_available
    if _tracer_available is not None:
        return _tracer

    try:
        from opentelemetry import trace
        _tracer = trace.get_tracer("flow_engine")
        _tracer_available = True
        logger.info("[tracing] OTel tracer initialized")
    except ImportError:
        _tracer = None
        _tracer_available = False
        logger.warning("[tracing] opentelemetry not installed — tracing disabled")

    return _tracer


async def start_execution_span(
    execution_id: str,
    flow_id: str,
    attributes: Optional[dict[str, str]] = None,
) -> Any:
    tracer = _get_tracer()
    if tracer is None:
        logger.debug("[tracing] No-op execution span", execution_id=execution_id, flow_id=flow_id)
        return None

    from opentelemetry import trace as otel_trace

    span_attrs = {
        "execution_id": execution_id,
        "flow_id": flow_id,
        **(attributes or {}),
    }
    span = tracer.start_as_current_span(
        "flow_execution",
        attributes=span_attrs,
        kind=otel_trace.SpanKind.INTERNAL,
    )
    logger.debug("[tracing] Started execution span", execution_id=execution_id)
    return span


async def start_node_span(
    parent_span: Any,
    node_id: str,
    iteration: int,
    node_kind: str,
) -> Any:
    tracer = _get_tracer()
    if tracer is None or parent_span is None:
        logger.debug("[tracing] No-op node span", node_id=node_id, iteration=iteration)
        return None

    span_attrs = {
        "node_id": node_id,
        "iteration": str(iteration),
        "node_kind": node_kind,
    }
    span = tracer.start_as_current_span(
        f"node.{node_kind}",
        attributes=span_attrs,
    )
    logger.debug("[tracing] Started node span", node_id=node_id, iteration=iteration)
    return span

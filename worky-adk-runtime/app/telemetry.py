"""AutoTracingPlugin (Part 3, canonical §4.3 + §4.4).

Wires a no-op OTel `SpanExporter` that calls the backend's
`cost_event` callback per `gen_ai.*` model span and the
`artifact` / `audit` callbacks for tool spans. The runtime
doesn't need a real OTel collector — the bridge is enough for
the backend to know the cost/tokens consumed per task. A future
hardening step can plug a real OTel collector in here without
touching the runtime/manager code.

The `setup_tracing()` is invoked once at app startup; the
`TracingPlugin` is mounted on the Manager's Runner via
`Runner(..., plugins=[TracingPlugin()])` in a future patch. For
Part 3 the bridge is exposed as a function the router calls
manually so the wire shape is correct without a real OTel SDK.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger("worky.telemetry")


def setup_tracing() -> None:
    """Initialize the tracing plugin. No-op for unit tests."""
    logger.debug("Worky runtime tracing ready (no-op exporter in Part 3)")


class TracingPlugin:
    """In-process plugin that bridges ADK model/tool spans to NestJS.

    The plugin is a callable that yields one cost-event payload per
    LLM/tool span. The execution router feeds each payload to
    `BackendClient.record_cost(...)` or `emit_audit(...)`.
    """

    def __init__(self, backend_client: Optional[Any] = None) -> None:
        self.backend_client = backend_client
        self.cost_events: list[dict[str, Any]] = []
        self.audit_events: list[dict[str, Any]] = []

    def on_model_span(self, span: dict[str, Any]) -> dict[str, Any]:
        """Convert a model span into a `cost_event` payload."""
        model_id = str(span.get("model") or span.get("model_id") or "unknown")
        payload = {
            "type": "llm",
            "provider": str(span.get("provider") or "litellm"),
            "model": model_id,
            "inputTokens": int(span.get("input_tokens", 0) or 0),
            "outputTokens": int(span.get("output_tokens", 0) or 0),
            "costUsd": float(span.get("cost_usd", 0) or 0),
            "taskId": span.get("task_id"),
        }
        self.cost_events.append(payload)
        if self.backend_client is not None:
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(
                        self.backend_client.record_cost(
                            span.get("stream_id") or "",
                            payload,
                        )
                    )
            except Exception:  # pragma: no cover
                logger.debug("Could not dispatch cost event (no event loop)")
        return payload

    def on_tool_span(self, span: dict[str, Any]) -> dict[str, Any]:
        """Convert a tool span into an `audit` event payload."""
        payload = {
            "action": "tool.call",
            "details": {
                "tool": span.get("name"),
                "durationMs": span.get("duration_ms", 0),
                "task_id": span.get("task_id"),
            },
        }
        self.audit_events.append(payload)
        return payload


def make_default_tracing_plugin(backend_client: Any) -> TracingPlugin:
    """Helper used by the execution router to get a plugin instance."""
    return TracingPlugin(backend_client=backend_client)

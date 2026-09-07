"""Monitoring and observability module.

This module contains monitoring and observability functionality:
- trace_recorder: Trace recording and tracking

These provide observability and monitoring capabilities for the system.
"""

from .trace_recorder import TraceRecorder

__all__ = [
    'TraceRecorder'
]

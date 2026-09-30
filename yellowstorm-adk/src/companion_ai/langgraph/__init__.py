"""LangGraph orchestrator (migration target).

Side-by-side with the ADK engine (service.py/nodes.py/graph.py/hitl.py). Reuses
the framework-neutral pieces unchanged: plan.py (Plan/Step) and readmodel.py
(plan_steps projection). Only the ENGINE changes — ADK Runner + DatabaseSession
service become a compiled StateGraph + a LangGraph checkpointer.

Walking-skeleton stage: linear/DAG execution + checkpointer + projection.
HITL (interrupt/resume), the tool-confirmation gate, MCP connectors, personas
and dynamic spawning land in later increments.
"""

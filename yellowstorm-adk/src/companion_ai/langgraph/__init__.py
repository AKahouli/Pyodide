"""LangGraph orchestrator (migration target).

Side-by-side with the ADK engine (adk/). Reuses the framework-neutral pieces
unchanged: plan.py (Plan/Step), scheduler.py and readmodel.py (plan_steps
projection). Only the ENGINE changes — ADK Runner + DatabaseSession service
become a Functional-API `@entrypoint` executor (graph.build_executor) + a
LangGraph checkpointer.

The executor is a scheduler-driven future loop, not a StateGraph: it launches
each ready step as a durable `@task` and advances on FIRST_COMPLETED, so an
independent branch never waits on a slow sibling in the same wave (langgraph
#6320). Pauses are state-driven (no interrupt()): ask waits on an `answers`
entry, await_reply on a `replies` entry — parallel waits don't block each other.
"""

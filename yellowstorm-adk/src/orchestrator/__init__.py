"""Agent Orchestrator feature.

Deterministic planning/execution core (framework-neutral) plus the ADK wiring.

Layers:
  plan.py       — Plan/Step domain model (depends_on drives parallelism).
  scheduler.py  — topological wave scheduler: which steps are ready to run now,
                  grouped into parallel waves. Pure, no LLM, no I/O.
"""

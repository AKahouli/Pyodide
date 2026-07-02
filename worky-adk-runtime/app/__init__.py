"""
Worky (Chief of Staff) ADK runtime — standalone FastAPI service.

Sibling of `yellowstorm-adk/` with its own venv, port (8011) and
`google-adk==2.2.0` pin (canonical §2). NestJS owns all product state; the
runtime only reasons / executes and calls back to `/worky/internal/*`.

The runtime owns no scheduler, no DB, no message broker. All timed work
is owned by NestJS via `WorkyScheduledEvent` + `@nestjs/schedule`
(Part 3). For Part 1 the runtime is a stub that proves the contract:
one planning endpoint, a backend client, and a LiteLLM-wired model
factory. Agents land in Part 3.
"""
__version__ = "0.1.0"

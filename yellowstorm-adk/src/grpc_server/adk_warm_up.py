"""Move google-adk's lazy first-request work to server startup."""

from __future__ import annotations

import asyncio

from yellowmind_observability import get_logger

logger = get_logger(__name__)


def _warm_model_type_imports() -> None:
    # On the first model request ADK imports every optional provider SDK
    # (anthropic, litellm, openai) to learn which models pair tool calls by
    # id. The anthropic SDK alone takes about 2 s to import and the import
    # blocks the event loop, so the first turn after a restart paid it before
    # its model call. The result is memoized, so one call here covers every
    # later request. Verified on google-adk 2.11.0; upgrade checklist:
    # docs/runbooks/adk-upgrade-session-seed-check.md
    from google.adk.flows.llm_flows.context import _contents

    pairing_model_types = getattr(_contents, "_id_pairing_model_types", None)
    if pairing_model_types is not None:
        pairing_model_types()


async def warm_up_adk_lazy_imports() -> None:
    """Best effort: on failure the first request simply imports lazily."""
    try:
        await asyncio.to_thread(_warm_model_type_imports)
    except Exception as error:
        logger.warning(
            "dependency.request.failed",
            dependency="google_adk",
            operation="lazy_import_warm_up",
            error=error,
        )

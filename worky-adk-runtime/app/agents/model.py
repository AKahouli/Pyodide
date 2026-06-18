"""Model factory for the Worky runtime.

Per canonical §1.1 and AGENTS.md invariants, every agent uses ADK's
`LiteLlm` wrapper (`from google.adk.models.lite_llm import LiteLlm`).
No direct provider SDK calls. The model id is *not* hardcoded — the
active provider/model/keys are resolved by LiteLLM from environment at
call time, mirroring the platform-wide `LITELLM_*` configuration.

In Part 1 this module only constructs the wrapper. Part 3 wires the
Manager `LlmAgent` and ephemeral worker factory to consume it.
"""
from __future__ import annotations

import logging
from typing import Any

try:
    from google.adk.models.lite_llm import LiteLlm
except Exception:  # pragma: no cover — google-adk may be absent in some envs
    LiteLlm = None  # type: ignore[assignment]

logger = logging.getLogger("worky.model")


def build_model(model_id: str | None = None) -> Any:
    """Build an ADK `LiteLlm` instance for the given model id.

    When `model_id` is `None`, the wrapper is constructed with the
    LiteLLM provider/model/keys resolved from environment at call time
    (so a `LiteLlm()` call still works in a LiteLLM-configured cluster).
    """
    if LiteLlm is None:  # pragma: no cover
        raise RuntimeError(
            "google-adk is not installed. Run `pip install -r requirements.txt`."
        )
    if model_id:
        logger.debug("Building LiteLlm wrapper", extra={"model": model_id})
        return LiteLlm(model=model_id)
    logger.debug("Building LiteLlm wrapper with environment-resolved defaults")
    return LiteLlm()

"""Model factory for the Worky runtime.

Per canonical §1.1 and AGENTS.md invariants, every agent uses ADK's
`LiteLlm` wrapper (`from google.adk.models.lite_llm import LiteLlm`).
No direct provider SDK calls. The endpoint (api_base + api_key) is
resolved from the runtime's `LITELLM_API_BASE_URL` and
`LITELLM_API_SECRET_KEY` env vars; the model id is *not* hardcoded
— it is selected per turn by the owner (PromptBar model select) or
falls back to the admin default forwarded by the backend.

The factory passes the env-resolved endpoint through to `LiteLlm` as
keyword args. ADK's `LiteLlm(model, **kwargs)` stores kwargs in
`_additional_args` and passes them straight to LiteLLM at call time
(verified against google-adk 2.2.0 at `google/adk/models/lite_llm.py`).
"""
from __future__ import annotations

import logging
from typing import Any

from ..config import get_settings

try:
    from google.adk.models.lite_llm import LiteLlm
except Exception:  # pragma: no cover — google-adk may be absent in some envs
    LiteLlm = None  # type: ignore[assignment]

logger = logging.getLogger("worky.model")


def _endpoint_kwargs() -> dict[str, str]:
    """Return `api_base` / `api_key` kwargs resolved from the runtime env.

    When `LITELLM_API_BASE_URL` is set, the runtime talks to a LiteLLM
    proxy. We set `custom_llm_provider="litellm_proxy"` so LiteLLM's
    client forwards the model name verbatim to the proxy instead of
    trying to parse a provider prefix locally (which fails for models
    like `minimax/minimax-m3` where the provider isn't in LiteLLM's
    built-in registry).
    """
    settings = get_settings()
    kwargs: dict[str, str] = {}
    if settings.litellm_api_base_url:
        kwargs["api_base"] = settings.litellm_api_base_url
        kwargs["custom_llm_provider"] = "litellm_proxy"
    if settings.litellm_api_secret_key:
        kwargs["api_key"] = settings.litellm_api_secret_key
    return kwargs


def build_model(model_id: str | None = None) -> Any:
    """Build an ADK `LiteLlm` instance for the given model id.

    `model_id` is the LiteLLM model identifier (e.g. `gpt-4o-mini`,
    `claude-3-5-sonnet-20240620`) — never the admin DB id. When
    `model_id` is `None`, the wrapper is constructed with just the
    env-resolved endpoint kwargs (or nothing if env is unset); the
    ADK layer will surface a clear error at first call time.

    Callers that want to fail fast (e.g. the planning/execution
    routers) should call `build_model` inside their own try/except
    and translate the `RuntimeError` into a `*.error` SSE frame.
    """
    if LiteLlm is None:  # pragma: no cover
        raise RuntimeError(
            "google-adk is not installed. Run `pip install -r requirements.txt`."
        )
    kwargs = _endpoint_kwargs()
    if model_id:
        logger.debug(
            "Building LiteLlm wrapper",
            extra={"model": model_id, "has_api_base": "api_base" in kwargs},
        )
        return LiteLlm(model=model_id, **kwargs)
    logger.debug("Building LiteLlm wrapper with env-resolved endpoint (no model)")
    return LiteLlm(**kwargs)

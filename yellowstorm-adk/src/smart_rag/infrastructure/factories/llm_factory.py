"""LLM Factory Module for creating and configuring language model instances.

This module provides a factory pattern implementation for creating various types
of LLM instances with different configurations, including parallel tool calling
support, streaming capabilities, and user context management.

Classes:
    LLMFactory: Factory class for creating LLM instances with different configurations.
"""

from typing import TYPE_CHECKING
from src.config.settings import get_settings
from src.middleware.correlation import get_user_label
from src.logger.logging import get_logger
import os
import asyncio
from weakref import WeakKeyDictionary
from typing import Dict, Any
from src.smart_rag.infrastructure.model_parameters import get_reasoning_effort_for_model, normalize_temperature_for_model, resolve_model_config

if TYPE_CHECKING:
    from google.adk.models.lite_llm import LiteLlm


logger = get_logger("api.smart_rag.llm_factory")
app_settings = get_settings()
os.environ["OLLAMA_API_BASE"] = app_settings.OLLAMA_API_BASE_URL
os.environ["OLLAMA_API_KEY"] = app_settings.OLLAMA_API_KEY

LLM_REQUEST_TIMEOUT_SECONDS = 90
LLM_REQUEST_NUM_RETRIES = 1
_gateway_http_owners = WeakKeyDictionary()


def _responses_http_client():
    """Borrow connections, never another turn's HTTP headers or cookie jar."""
    import httpx
    from openai import DefaultAsyncHttpxClient
    from src.smart_rag.infrastructure.monitoring.latency_diagnostics import (
        trace_responses_http_request, trace_responses_http_response,
    )
    hooks = {'request': [trace_responses_http_request], 'response': [trace_responses_http_response]}
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return DefaultAsyncHttpxClient(http2=True, event_hooks=hooks)
    owner = _gateway_http_owners.get(loop)
    if owner is None or owner.is_closed:
        owner = DefaultAsyncHttpxClient(http2=True)
        _gateway_http_owners[loop] = owner

    class BorrowedTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            # Keep HTTPX's configured environment-proxy routing. Calling only
            # the transport avoids sharing the owner's cookies/headers/auth.
            return await owner._transport_for_url(request.url).handle_async_request(request)

        async def aclose(self):
            # The lifespan owns the pool; a completed turn closes only its client.
            pass

    return DefaultAsyncHttpxClient(transport=BorrowedTransport(), event_hooks=hooks)


async def close_shared_gateway_http_client():
    owner = _gateway_http_owners.pop(asyncio.get_running_loop(), None)
    if owner is not None:
        await owner.aclose()


def _resolve_model_config(model_name: str | dict) -> str:
    return resolve_model_config(model_name)


def _temperature_for_model(model_name: str, temperature: float | None) -> float:
    requested_temperature = temperature if temperature is not None else 0.0
    normalized = normalize_temperature_for_model(model_name, requested_temperature)
    return 0.0 if normalized is None else normalized

class LLMFactory:
    """Factory class for creating LLM instances with different configurations.

    This factory provides static methods for creating language model instances
    with specific configurations tailored for different use cases in the smart RAG system.
    Supports both tool-enabled and tool-disabled models with streaming capabilities.

    Methods:
        create_parallel_tool_calls_llm: Creates LLM instance with parallel tool calls disabled.
        create_no_tool_calls_llm: Creates LLM instance without tool calling capabilities.
    """
    @staticmethod
    def for_conversation(model, conversation_api='chat_completions', *,
                         responses_history_mode='application', reasoning_history='auto', reasoning_summary='off'):
        """Use the catalog's explicit API selection; legacy models keep completions."""
        from google.adk.models.lite_llm import LiteLlm
        from openai import AsyncOpenAI
        from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedResponsesLlm
        if conversation_api not in ('chat_completions', 'responses'):
            raise ValueError('Unsupported conversation API')
        if conversation_api == 'chat_completions' or not isinstance(model, LiteLlm):
            return model
        if responses_history_mode not in ('application', 'provider') or reasoning_history not in ('none', 'last', 'all', 'auto'):
            raise ValueError('Unsupported Responses history policy')
        if reasoning_summary not in ('off', 'auto', 'concise', 'detailed'):
            raise ValueError('Unsupported reasoning summary')
        if responses_history_mode == 'provider' and reasoning_history != 'auto':
            raise ValueError('Provider-managed history requires automatic reasoning history')
        args = model._additional_args
        reasoning = {'effort': args['reasoning_effort']} if args.get('reasoning_effort') else {}
        if reasoning_summary != 'off':
            reasoning['summary'] = reasoning_summary
        extra = {'max_output_tokens': args.get('max_completion_tokens', 20000)}
        for key in ('temperature', 'user'):
            if key in args:
                extra[key] = args[key]
        # The final request may have no tools after a callback/skill activation.
        if args.get('tool_choice') is not None:
            extra['tool_choice'] = args['tool_choice']
        return InstrumentedResponsesLlm(
            model=model.model,
            client=AsyncOpenAI(
                http_client=_responses_http_client(),
                base_url=app_settings.LITELLM_API_BASE_URL,
                api_key=app_settings.LITELLM_API_SECRET_KEY,
                timeout=args.get('timeout', LLM_REQUEST_TIMEOUT_SECONDS),
                max_retries=0 if getattr(get_settings(), 'ROOT_WORK_LLM_CAPACITY_ENABLED', False) else args.get('num_retries', LLM_REQUEST_NUM_RETRIES),
            ),
            store=False,
            history_mode=responses_history_mode,
            reasoning_history=reasoning_history,
            summary_mode=reasoning_summary,
            include=['reasoning.encrypted_content'] if reasoning_history != 'none' else None,
            parallel_tool_calls=args.get('parallel_tool_calls'),
            reasoning=reasoning or None,
            extra_request_args=extra,
        )

    @staticmethod
    def create_parallel_tool_calls_llm(model_name: str, temperature=0.0,max_completion_tokens=20000) -> 'LiteLlm':
        """Create an LLM instance with parallel tool calls enabled.

        Creates a language model configured for parallel tool execution,
        allowing the LLM to return multiple tool calls in a single response
        that are executed concurrently for faster agent workflows.

        Args:
            model_name (str): Name or identifier of the language model to create.
                Can also accept a dictionary with 'provider' key.

            temperature (float, optional): Temperature setting for the model.
        Returns:
            LiteLlm: Configured LLM instance with streaming enabled and parallel
                tool calls enabled for concurrent execution.
        Raises:
            Exception: If LLM creation fails due to configuration or connection issues.
        """
        try:
            import litellm
            litellm.drop_params = True
            from google.adk.models.lite_llm import LiteLlm
            from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedLiteLlm
            model_name = _resolve_model_config(model_name)
            model_temperature = _temperature_for_model(model_name, temperature)
            reasoning_effort = get_reasoning_effort_for_model(model_name)

            # Create new LLM instance
            if "ollama" in model_name.lower():
                llm = InstrumentedLiteLlm(
                    model=model_name,
                    api_base=app_settings.OLLAMA_API_BASE_URL,
                    api_key=app_settings.OLLAMA_API_KEY,
                    stream=True,
                    user=get_user_label(),
                    timeout=LLM_REQUEST_TIMEOUT_SECONDS,
                    num_retries=LLM_REQUEST_NUM_RETRIES,
                    **({"temperature": model_temperature} if temperature is not None else {}),
                    max_completion_tokens=max_completion_tokens,
                    **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),
                )
                logger.info(f"Successfully created Ollama LLM for model: {model_name}")
            else:
                llm = InstrumentedLiteLlm(
                    model=model_name,
                    api_base=app_settings.LITELLM_API_BASE_URL,
                    api_key=app_settings.LITELLM_API_SECRET_KEY,
                    parallel_tool_calls=True,
                    stream=True,
                    user=get_user_label(),
                    timeout=LLM_REQUEST_TIMEOUT_SECONDS,
                    num_retries=LLM_REQUEST_NUM_RETRIES,
                    **({"temperature": model_temperature} if temperature is not None else {}),
                    max_completion_tokens=max_completion_tokens,
                    **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),
                )
                logger.info(f"Successfully created LiteLLM proxy LLM for model: {model_name}")

            return llm
        except Exception as e:
            logger.error(f"Failed to create parallel tool calls LLM for model {model_name}: {str(e)}")
            raise

    @staticmethod
    def create_no_parallel_tool_calls_llm(model_name: str, temperature=0.0, tool_choice:str="auto",max_completion_tokens=20000) -> 'LiteLlm':
        """Create an LLM instance without tool calls."""

        try:
            import litellm
            litellm.drop_params = True
            from google.adk.models.lite_llm import LiteLlm
            from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedLiteLlm
            model_name = _resolve_model_config(model_name)
            model_temperature = _temperature_for_model(model_name, temperature)
            reasoning_effort = get_reasoning_effort_for_model(model_name)

            # Create new LLM instance
            if "ollama" in model_name.lower():
                llm = InstrumentedLiteLlm(
                    model=model_name,
                    api_base=app_settings.OLLAMA_API_BASE_URL,
                    api_key=app_settings.OLLAMA_API_KEY,
                    stream=True,
                    user=get_user_label(),
                    timeout=LLM_REQUEST_TIMEOUT_SECONDS,
                    num_retries=LLM_REQUEST_NUM_RETRIES,
                    **({"temperature": model_temperature} if temperature is not None else {}),
                    max_completion_tokens=max_completion_tokens,
                    **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),

                )
                logger.info(f"Successfully created Ollama no-tool-calls LLM for model: {model_name}")
            else:
                llm = InstrumentedLiteLlm(
                    model=model_name,
                    api_base=app_settings.LITELLM_API_BASE_URL,
                    api_key=app_settings.LITELLM_API_SECRET_KEY,
                    stream=True,
                    parallel_tool_calls=False,
                    user=get_user_label(),
                    timeout=LLM_REQUEST_TIMEOUT_SECONDS,
                    num_retries=LLM_REQUEST_NUM_RETRIES,
                    **({"temperature": model_temperature} if temperature is not None else {}),
                    tool_choice=tool_choice,
                    max_completion_tokens=max_completion_tokens,
                    **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),

                )
                logger.info(f"Successfully created LiteLLM proxy no-tool-calls LLM for model: {model_name}")
            return llm
        except Exception as e:
            logger.error(f"Failed to create no tool calls LLM for model {model_name}: {str(e)}")
            raise

    @staticmethod
    def create_no_tool_calls_llm(
        model_name: str,
        temperature=0.0,
        max_completion_tokens=20000,
        num_retries: int | None = None,
    ) -> 'LiteLlm':
        """Create an LLM instance without tool calls."""
        try:
            import litellm
            litellm.drop_params = True
            from google.adk.models.lite_llm import LiteLlm
            from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedLiteLlm
            model_name = _resolve_model_config(model_name)
            model_temperature = _temperature_for_model(model_name, temperature)
            reasoning_effort = get_reasoning_effort_for_model(model_name)
            # Create new LLM instance
            if "ollama" in model_name.lower():
                llm = InstrumentedLiteLlm(
                    model=model_name,
                    api_base=app_settings.OLLAMA_API_BASE_URL,
                    api_key=app_settings.OLLAMA_API_KEY,
                    stream=True,
                    user=get_user_label(),
                    timeout=LLM_REQUEST_TIMEOUT_SECONDS,
                    **({"temperature": model_temperature} if temperature is not None else {}),
                    max_completion_tokens=max_completion_tokens,
                    **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),
                    num_retries=LLM_REQUEST_NUM_RETRIES if num_retries is None else num_retries,
                )
                logger.info(f"Successfully created Ollama no-tool-calls LLM for model: {model_name}")
            else:
                llm = InstrumentedLiteLlm(
                    model=model_name,
                    api_base=app_settings.LITELLM_API_BASE_URL,
                    api_key=app_settings.LITELLM_API_SECRET_KEY,
                    stream=True,
                    user=get_user_label(),
                    timeout=LLM_REQUEST_TIMEOUT_SECONDS,
                    **({"temperature": model_temperature} if temperature is not None else {}),
                    max_completion_tokens=max_completion_tokens,
                    **({"reasoning_effort": reasoning_effort} if reasoning_effort else {}),
                    num_retries=LLM_REQUEST_NUM_RETRIES if num_retries is None else num_retries,
                )
                logger.info(f"Successfully created LiteLLM proxy no-tool-calls LLM for model: {model_name}")
            return llm
        except Exception as e:
            logger.error(f"Failed to create no tool calls LLM for model {model_name}: {str(e)}")
            raise

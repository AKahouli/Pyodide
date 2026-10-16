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
    def for_conversation(model):
        """Adapt the built OpenAI conversation model; keep other providers unchanged."""
        from google.adk.models.lite_llm import LiteLlm
        from openai import AsyncOpenAI
        from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedResponsesLlm
        if not isinstance(model, LiteLlm):
            return model
        name = model.model.lower()
        if not name.startswith(('openai/', 'azure/', 'gpt-', 'o1', 'o3', 'o4')):
            return model
        args = model._additional_args
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
                base_url=app_settings.LITELLM_API_BASE_URL,
                api_key=app_settings.LITELLM_API_SECRET_KEY,
                timeout=args.get('timeout', LLM_REQUEST_TIMEOUT_SECONDS),
                max_retries=0 if getattr(get_settings(), 'ROOT_WORK_LLM_CAPACITY_ENABLED', False) else args.get('num_retries', LLM_REQUEST_NUM_RETRIES),
            ),
            store=False,
            parallel_tool_calls=args.get('parallel_tool_calls'),
            reasoning={'effort': args['reasoning_effort']} if args.get('reasoning_effort') else None,
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

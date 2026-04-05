"""LLM Factory Module for creating and configuring language model instances.

This module provides a factory pattern implementation for creating various types
of LLM instances with different configurations, including parallel tool calling
support, streaming capabilities, and user context management.

Classes:
    LLMFactory: Factory class for creating LLM instances with different configurations.
"""

from typing import TYPE_CHECKING
from src.config.settings import get_settings
from src.middleware.correlation import get_user
from src.logger.logging import get_logger
import os
from typing import Dict, Any

if TYPE_CHECKING:
    from google.adk.models.lite_llm import LiteLlm


logger = get_logger("api.smart_rag.llm_factory")
app_settings = get_settings()
os.environ["OLLAMA_API_BASE"] = app_settings.OLLAMA_API_BASE_URL
os.environ["OLLAMA_API_KEY"] = app_settings.OLLAMA_API_KEY

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
    def create_parallel_tool_calls_llm(model_name: str, temperature=None,max_completion_tokens=20000) -> 'LiteLlm':
        """Create an LLM instance with parallel tool calls disabled.

        Creates a language model configured for sequential tool execution,
        which is necessary for complex agent agentic_workflows where tool order matters.
        Args:
            model_name (str): Name or identifier of the language model to create.
                Can also accept a dictionary with 'provider' key.

            temperature (float, optional): Temperature setting for the model.
        Returns:
            LiteLlm: Configured LLM instance with streaming enabled and parallel
                tool calls disabled for sequential execution.

                tool calls enabled for faster execution.
        Raises:
            Exception: If LLM creation fails due to configuration or connection issues.
        """
        try:
            import litellm
            litellm.drop_params = True
            from google.adk.models.lite_llm import LiteLlm
            if isinstance(model_name, dict):
                model_name = str(model_name.get('provider'))

            # Create new LLM instance
            if "ollama" in model_name.lower():
                llm = LiteLlm(
                    model=model_name,
                    api_base=app_settings.OLLAMA_API_BASE_URL,
                    api_key=app_settings.OLLAMA_API_KEY,
                    stream=True,
                    user=get_user(),
                    temperature=temperature if temperature is not None else 0.0,
                    max_completion_tokens=max_completion_tokens
                )
                logger.info(f"Successfully created Ollama LLM for model: {model_name}")
            else:
                llm = LiteLlm(
                    model=model_name,
                    api_base=app_settings.LITELLM_API_BASE_URL,
                    api_key=app_settings.LITELLM_API_SECRET_KEY,
                    parallel_tool_calls=False,
                    stream=True,
                    user=get_user(),
                    temperature=temperature if temperature is not None else 0.0,
                    max_completion_tokens=max_completion_tokens
                )
                logger.info(f"Successfully created LiteLLM proxy LLM for model: {model_name}")

            return llm
        except Exception as e:
            logger.error(f"Failed to create parallel tool calls LLM for model {model_name}: {str(e)}")
            raise

    @staticmethod
    def create_no_parallel_tool_calls_llm(model_name: str, temperature=None, tool_choice:str="auto",max_completion_tokens=20000) -> 'LiteLlm':
        """Create an LLM instance without tool calls."""

        try:
            import litellm
            litellm.drop_params = True
            from google.adk.models.lite_llm import LiteLlm
            if isinstance(model_name, dict):
                model_name = str(model_name.get('provider'))

            # Create new LLM instance
            if "ollama" in model_name.lower():
                llm = LiteLlm(
                    model=model_name,
                    api_base=app_settings.OLLAMA_API_BASE_URL,
                    api_key=app_settings.OLLAMA_API_KEY,
                    stream=True,
                    user=get_user(),
                    temperature=temperature if temperature is not None else 0.0,
                    max_completion_tokens=max_completion_tokens

                )
                logger.info(f"Successfully created Ollama no-tool-calls LLM for model: {model_name}")
            else:
                llm = LiteLlm(
                    model=model_name,
                    api_base=app_settings.LITELLM_API_BASE_URL,
                    api_key=app_settings.LITELLM_API_SECRET_KEY,
                    stream=True,
                    parallel_tool_calls=False,
                    user=get_user(),
                    temperature=temperature if temperature is not None else 0.0,
                    tool_choice=tool_choice,
                    max_completion_tokens=max_completion_tokens

                )
                logger.info(f"Successfully created LiteLLM proxy no-tool-calls LLM for model: {model_name}")
            return llm
        except Exception as e:
            logger.error(f"Failed to create no tool calls LLM for model {model_name}: {str(e)}")
            raise

    @staticmethod
    def create_no_tool_calls_llm(model_name: str, temperature=None,max_completion_tokens=20000) -> 'LiteLlm':
        """Create an LLM instance without tool calls."""
        try:
            import litellm
            litellm.drop_params = True
            from google.adk.models.lite_llm import LiteLlm
            if isinstance(model_name, dict):
                model_name = str(model_name.get('provider'))
            # Create new LLM instance
            if "ollama" in model_name.lower():
                llm = LiteLlm(
                    model=model_name,
                    api_base=app_settings.OLLAMA_API_BASE_URL,
                    api_key=app_settings.OLLAMA_API_KEY,
                    stream=True,
                    user=get_user(),
                    temperature=temperature if temperature is not None else 0.0,
                    max_completion_tokens=max_completion_tokens
                )
                logger.info(f"Successfully created Ollama no-tool-calls LLM for model: {model_name}")
            else:
                llm = LiteLlm(
                    model=model_name,
                    api_base=app_settings.LITELLM_API_BASE_URL,
                    api_key=app_settings.LITELLM_API_SECRET_KEY,
                    stream=True,
                    user=get_user(),
                    temperature=temperature if temperature is not None else 0.0,
                    max_completion_tokens=max_completion_tokens
                )
                logger.info(f"Successfully created LiteLLM proxy no-tool-calls LLM for model: {model_name}")
            return llm
        except Exception as e:
            logger.error(f"Failed to create no tool calls LLM for model {model_name}: {str(e)}")
            raise

"""Service for simple OpenAI chat completion without RAG or agents.

This module provides a simplified interface for direct OpenAI chat completions.
"""

from typing import Optional
from openai import AsyncOpenAI
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.smart_rag.infrastructure.model_parameters import normalize_temperature_for_model

logger = get_logger("api.smart_rag.SimpleCompletion")
app_settings = get_settings()


class SimpleCompletionService:
    """Service for handling simple OpenAI chat completions."""

    def __init__(self):
        """Initialize the SimpleCompletionService."""
        self.client = AsyncOpenAI(base_url=app_settings.LITELLM_API_BASE_URL, api_key=app_settings.LITELLM_API_SECRET_KEY)

    async def create_completion(
        self,
        message: str,
        model: str,
        temperature: Optional[float] = 0.7,
        max_tokens: Optional[int] = None
    ) -> str:
        """Create a chat completion using OpenAI API.

        Args:
            message: The user message/question
            model: The OpenAI model to use (required)
            temperature: Sampling temperature between 0 and 2
            max_tokens: Maximum number of tokens to generate (optional)

        Returns:
            str: The assistant's response content

        Raises:
            ValueError: If message or model is invalid
            Exception: For OpenAI API errors
        """
        try:
            # Validate inputs
            if not message or not isinstance(message, str):
                raise ValueError("Message must be a non-empty string")

            if not model or not isinstance(model, str):
                raise ValueError("Model must be a non-empty string")

            logger.info(f"Creating chat completion with model {model}")
            logger.debug(f"Message: {message[:100]}...")

            # Prepare messages for OpenAI with system prompt
            messages = [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": message}
            ]

            # Prepare request parameters
            request_params = {
                "model": model,
                "messages": messages,
            }

            normalized_temperature = normalize_temperature_for_model(model, temperature)
            if normalized_temperature is not None:
                request_params["temperature"] = normalized_temperature

            # Add optional parameters if provided
            if max_tokens:
                request_params["max_tokens"] = max_tokens

            # Call OpenAI API
            response = await self.client.chat.completions.create(**request_params)

            # Extract response content
            content = response.choices[0].message.content

            logger.info(
                f"Completion successful - Tokens used: {response.usage.total_tokens} "
                f"(prompt: {response.usage.prompt_tokens}, "
                f"completion: {response.usage.completion_tokens})"
            )

            return content

        except ValueError as ve:
            logger.error(f"Validation error in create_completion: {str(ve)}")
            raise

        except Exception as e:
            logger.error(f"Error in create_completion: {str(e)}", exc_info=True)
            raise Exception(f"OpenAI API error: {str(e)}") from e

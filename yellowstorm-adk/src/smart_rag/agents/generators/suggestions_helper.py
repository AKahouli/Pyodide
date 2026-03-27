import json
from typing import List, Dict, Any
from src.logger.logging import get_logger
import re2 as re
logger = get_logger("suggestions_helper")

def model_supports_structured_output( model_name: str) -> bool:
    """Check if the model supports structured output."""
    if not model_name:
        return False

    model_name_lower = model_name.lower()

    # Models that DON'T support structured output
    unsupported_models = [
        "ollama_chat/gpt-oss:20b",
        "openrouter/openai/gpt-oss-20b",
        "gpt-oss-20b",
        "azure/gpt-5-chat",
        "gpt-5-chat",
        # Add other models that don't support structured output here
    ]

    for unsupported in unsupported_models:
        if unsupported in model_name_lower:
            return False

    # Most modern GPT models support structured output by default
    # Add specific checks for other model families if needed
    return True


def parse_suggestions_response(response) -> List[Dict[str, Any]]:
    """Parse the suggestions response."""
    suggestions = []

    if isinstance(response.text, str):
        try:
            response_json = json.loads(response.text)
            suggestions = response_json
        except json.JSONDecodeError:
            # For models that don't support structured output, try to extract JSON from text
            logger.warning("Failed to parse JSON response, attempting to extract JSON from text")
            suggestions = extract_json_from_text(response.text)

    return suggestions

def extract_json_from_text(text: str) -> Dict[str, Any]:
    """Extract JSON from unstructured text response."""
    # Try to find JSON in the text using regex
    json_pattern = r'\{.*?\}'
    matches = re.findall(json_pattern, text, re.DOTALL)

    for match in matches:
        try:
            # Try to parse each potential JSON match
            parsed = json.loads(match)
            if isinstance(parsed, dict) and ('suggestions' in parsed or 'available_agent_ids' in parsed):
                return parsed
        except json.JSONDecodeError:
            continue

    # If no valid JSON found, return empty structure
    logger.error(f"Could not extract valid JSON from response: {text}")
    return {"suggestions": [], "available_agent_ids": []}

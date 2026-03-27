"""
Prompt Processor Module

Handles prompt processing, extraction, and transformation operations.
"""

from typing import Tuple, Optional
import re2 as re
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.prompt_processor")
app_settings = get_settings()


class PromptProcessor:
    """Handles prompt processing and extraction operations."""

    @staticmethod
    def extract_chatbot_name_and_clean_prompt(prompt: str, chatbot_name: str = None) -> Tuple[str, str]:
        """Extract chatbot name from prompt and return cleaned prompt."""
        lines = prompt.strip().splitlines()
        if not lines:
            return prompt.strip(), chatbot_name

        first_line = lines[0].strip()
        tags = re.findall(r'@([\w\-]+)', first_line.lower())

        for tag in tags:
            if tag.startswith("azure/") or tag.startswith("gpt-"):
                # Remove 'azure/' if it exists
                chatbot_name = tag.replace("azure/", "")
                break

        # Remove the first line if it had a tag
        if "@" in first_line:
            cleaned_prompt = "\n".join(lines[1:]).strip()
        else:
            cleaned_prompt = prompt.strip()

        return cleaned_prompt, chatbot_name

    @staticmethod
    def extract_prompts(description: str) -> Tuple[str, str, str, str, str, str, str, str,str]:
        """Extract individual agent prompts from description."""
        try:
            logger.debug("Extracting prompts from description")
            parts = description.split("###")
            parts = [part.strip() for part in parts]

            # Handle variable-length parts, use empty string for missing ones
            return (
                parts[0] if len(parts) > 0 else "",  # agent_1_prompt (search)
                parts[1] if len(parts) > 1 else "",  # agent_2_prompt (operator)
                parts[2] if len(parts) > 2 else "",  # agent_3_prompt (reporter)
                parts[3] if len(parts) > 3 else "",  # agent_4_prompt (visualizer)
                parts[4] if len(parts) > 4 else "",  # manager_prompt
                parts[5] if len(parts) > 5 else "",  # second manager prompt
                parts[6] if len(parts) > 6 else "",  # report writer prompt
                parts[7] if len(parts) > 7 else "",  # suggestions prompt
                parts[8] if len(parts) > 8 else ""   # response format for html agents prompt
            )
        except Exception as e:
            logger.error(f"Failed to extract prompts from description: {str(e)}")
            raise

    @staticmethod
    def get_web_search_prompt(index: int) -> str:
        """Get web search prompt by index."""
        try:
            prompts = app_settings.WEB_SEARCH_PROMPT.split("|||")
            if 1 <= index <= len(prompts):
                return prompts[index - 1].strip()
            raise IndexError(f"Prompt index {index} out of range. Must be between 1 and {len(prompts)}.")
        except Exception as e:
            logger.error(f"Failed to get web search prompt for index {index}: {str(e)}")
            raise

    @staticmethod
    def extract_task_description(text: str) -> Optional[str]:
        """Extract task description from text."""
        pattern = r"< task_description >([\s\S]*?)<\\ task_description>"
        match = re.search(pattern, text)
        if match:
            return match.group(1).strip()
        return text

    @staticmethod
    def clean_prompt_text(text: str) -> str:
        """Clean and normalize prompt text."""
        if not text:
            return ""
        
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text.strip())
        
        # Remove common formatting artifacts
        text = re.sub(r'^\s*[-=*]+\s*$', '', text, flags=re.MULTILINE)
        
        return text.strip()

    @staticmethod
    def validate_prompt_structure(description: str) -> bool:
        """Validate that the prompt has the expected structure."""
        try:
            parts = description.split("###")
            return len(parts) >= 8
        except Exception:
            return False

    @staticmethod
    def merge_prompts_with_context(base_prompt: str, additional_context: str) -> str:
        """Merge base prompt with additional context."""
        if not additional_context:
            return base_prompt
        
        if not base_prompt:
            return additional_context
        
        # Add context with proper spacing
        return f"{base_prompt}\n\n{additional_context}"

    @classmethod
    def process_manager_prompt(cls, manager_prompt: str, tree_info: str = "", 
                             web_search_context: str = "") -> str:
        """Process manager prompt by adding tree information and web search context."""
        processed_prompt = cls.clean_prompt_text(manager_prompt)
        
        if tree_info:
            processed_prompt = cls.merge_prompts_with_context(processed_prompt, tree_info)
        
        if web_search_context:
            processed_prompt = cls.merge_prompts_with_context(processed_prompt, web_search_context)
        
        return processed_prompt

    @classmethod
    def process_agent_prompt(cls, agent_prompt: str, web_search_context: str = "", 
                           tree_info: str = "") -> str:
        """Process agent prompt by adding web search and tree context."""
        processed_prompt = cls.clean_prompt_text(agent_prompt)
        
        if web_search_context:
            processed_prompt = cls.merge_prompts_with_context(processed_prompt, web_search_context)
        
        if tree_info:
            processed_prompt = cls.merge_prompts_with_context(processed_prompt, tree_info)
        
        return processed_prompt
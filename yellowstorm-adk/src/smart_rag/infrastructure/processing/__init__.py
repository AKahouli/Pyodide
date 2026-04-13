"""Processing helpers module.

This module contains processing helpers and utilities:
- prompt_processor: Prompt processing functionality
- context_builder: Context building utilities  
- callback_helper: Callback helper functions

These provide supporting functionality for processing and preparation.
"""

__all__ = [
    'PromptProcessor',
    'ContextBuilder',
    'add_timestamp_to_agent',
    'append_suggested_agents',
    'modify_suggested_agents',
    'add_additional_context',
    'get_structured_context',
    'catch_images_after_tool',
    'inject_images_before_model',
    'add_diagram_context_before_tool',
    'catch_diagram_after_tool',
]


def __getattr__(name: str):
    if name == 'PromptProcessor':
        from .prompt_processor import PromptProcessor
        return PromptProcessor
    if name == 'ContextBuilder':
        from .context_builder import ContextBuilder
        return ContextBuilder
    if name in {
        'add_timestamp_to_agent',
        'append_suggested_agents',
        'modify_suggested_agents',
        'add_additional_context',
        'get_structured_context',
        'catch_images_after_tool',
        'inject_images_before_model',
        'add_diagram_context_before_tool',
        'catch_diagram_after_tool',
    }:
        from .callback_helper import __dict__ as callback_dict
        return callback_dict[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

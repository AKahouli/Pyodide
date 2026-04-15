"""Infrastructure factories module.

This module contains infrastructure factory classes:
- llm_factory: LLM factory for creating language model instances

These provide factory patterns for creating infrastructure components.
"""

__all__ = [
    'LLMFactory'
]


def __getattr__(name: str):
    if name == 'LLMFactory':
        from .llm_factory import LLMFactory
        return LLMFactory
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

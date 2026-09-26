"""Legacy shim: create_enhanced_prompt now lives in delegation_factory."""

from src.smart_rag.agents.factories.delegation_factory import create_enhanced_prompt

__all__ = ["create_enhanced_prompt"]

"""Legacy shim: ManagerAgentFactory now lives in base_factory (the consolidated agent factory module)."""

from src.smart_rag.agents.factories.base_factory import ManagerAgentFactory

__all__ = ["ManagerAgentFactory"]

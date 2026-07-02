"""Unit tests for smart_rag package lazy imports."""

import importlib

import pytest


@pytest.fixture
def fresh_smart_rag_module():
    """Reload smart_rag without removing it from sys.modules (keeps patch targets stable)."""
    import src.smart_rag as smart_rag

    return importlib.reload(smart_rag)


class TestSmartRagLazyImports:
  def test_lazy_import_chat_rag_service(self, fresh_smart_rag_module):
    service_cls = fresh_smart_rag_module.ChatRAGService
    assert service_cls.__name__ == "ChatRAGService"

  def test_lazy_import_agent_team_service(self, fresh_smart_rag_module):
    service_cls = fresh_smart_rag_module.AgentTeamService
    assert service_cls.__name__ == "AgentTeamService"

  def test_lazy_import_unknown_attribute_raises(self, fresh_smart_rag_module):
    with pytest.raises(AttributeError, match="NotARealExport"):
      _ = fresh_smart_rag_module.NotARealExport

  def test_module_exports_all(self, fresh_smart_rag_module):
    assert set(fresh_smart_rag_module.__all__) == {
      "ChatRAGService",
      "AgentTeamService",
    }

  def test_version_and_author_metadata(self, fresh_smart_rag_module):
    assert fresh_smart_rag_module.__version__ == "1.0.0"
    assert fresh_smart_rag_module.__author__ == "SmartRAG Team"

  def test_repeated_lazy_import_returns_same_class(self, fresh_smart_rag_module):
    first = fresh_smart_rag_module.ChatRAGService
    second = fresh_smart_rag_module.ChatRAGService
    assert first is second

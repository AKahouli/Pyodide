"""Unit tests for delegation factory utils."""

from unittest.mock import MagicMock

from src.smart_rag.agents.factories.utils import create_enhanced_prompt


class TestFactoryUtils:
    def test_create_enhanced_prompt(self):
        tool_provider = MagicMock()
        tool_provider.get_tools_description.return_value = "\nTools"
        prompt = create_enhanced_prompt(
            tool_provider,
            MagicMock(),
            {"prompt": "Base", "html": False},
            ["search"],
        )
        assert prompt.startswith("Base")
        assert "Tools" in prompt

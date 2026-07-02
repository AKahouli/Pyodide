"""Unit tests for PromptProcessor."""

import re as std_re

import pytest

from src.smart_rag.infrastructure.processing import prompt_processor as prompt_processor_mod
from src.smart_rag.infrastructure.processing.prompt_processor import PromptProcessor


@pytest.fixture(autouse=True)
def use_stdlib_re(monkeypatch):
    monkeypatch.setattr(prompt_processor_mod, "re", std_re)


class TestPromptProcessor:
    def test_extract_chatbot_name_from_first_line(self):
        prompt = "@gpt-4o\nYou are helpful."
        cleaned, name = PromptProcessor.extract_chatbot_name_and_clean_prompt(prompt, None)
        assert name == "gpt-4o"
        assert cleaned == "You are helpful."

    def test_extract_chatbot_name_keeps_prompt_when_no_tag(self):
        prompt = "Plain prompt"
        cleaned, name = PromptProcessor.extract_chatbot_name_and_clean_prompt(prompt, "fallback")
        assert cleaned == "Plain prompt"
        assert name == "fallback"

    def test_extract_prompts_splits_sections(self):
        description = "a###b###c###d###e###f###g###h###i"
        parts = PromptProcessor.extract_prompts(description)
        assert parts[0] == "a"
        assert parts[8] == "i"

    def test_extract_prompts_handles_short_description(self):
        parts = PromptProcessor.extract_prompts("only-one")
        assert parts[0] == "only-one"
        assert parts[1] == ""

    def test_get_web_search_prompt_by_index(self, monkeypatch):
        monkeypatch.setattr(
            "src.smart_rag.infrastructure.processing.prompt_processor.app_settings.WEB_SEARCH_PROMPT",
            "first|||second",
        )
        assert PromptProcessor.get_web_search_prompt(1) == "first"
        assert PromptProcessor.get_web_search_prompt(2) == "second"

    def test_get_web_search_prompt_out_of_range_raises(self, monkeypatch):
        monkeypatch.setattr(
            "src.smart_rag.infrastructure.processing.prompt_processor.app_settings.WEB_SEARCH_PROMPT",
            "only",
        )
        with pytest.raises(IndexError):
            PromptProcessor.get_web_search_prompt(5)

    def test_extract_task_description_from_tags(self):
        text = "< task_description >Do the thing<\\ task_description>"
        assert PromptProcessor.extract_task_description(text) == "Do the thing"

    def test_clean_prompt_text_collapses_whitespace(self):
        assert PromptProcessor.clean_prompt_text("  hello   world  ") == "hello world"

    def test_validate_prompt_structure(self):
        assert PromptProcessor.validate_prompt_structure(
            "a###b###c###d###e###f###g###h"
        ) is True
        assert PromptProcessor.validate_prompt_structure("short") is False

    def test_process_agent_prompt_adds_context(self):
        processed = PromptProcessor.process_agent_prompt(
            "agent base",
            web_search_context="web ctx",
            tree_info="tree ctx",
        )
        assert "agent base" in processed
        assert "web ctx" in processed
        assert "tree ctx" in processed

    def test_merge_and_process_prompts(self):
        merged = PromptProcessor.merge_prompts_with_context("base", "extra")
        assert "base" in merged and "extra" in merged
        processed = PromptProcessor.process_manager_prompt(
            "manager",
            tree_info="tree",
            web_search_context="web",
        )
        assert "manager" in processed
        assert "tree" in processed
        assert "web" in processed

"""Tests for PromptBuilder utility."""

import pytest
from src.attribute_extraction.utilities.prompt_builder import PromptBuilder
from src.attribute_extraction.schema.models import AttributeDefinition


class TestPromptBuilder:
    """Test cases for PromptBuilder utility."""

    def test_build_extraction_prompt_single_attribute(self):
        """Test building prompt with single attribute."""
        attributes = {
            "company_name": AttributeDefinition(
                description="Name of the company",
                type="string"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "document analysis assistant" in prompt.lower()
        assert "company_name" in prompt
        assert "Name of the company" in prompt
        assert "(string)" in prompt

    def test_build_extraction_prompt_multiple_attributes(self):
        """Test building prompt with multiple attributes."""
        attributes = {
            "company_name": AttributeDefinition(
                description="Name of the company",
                type="string"
            ),
            "revenue": AttributeDefinition(
                description="Annual revenue in millions",
                type="number"
            ),
            "is_public": AttributeDefinition(
                description="Whether company is publicly traded",
                type="boolean"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        # Check all attributes are mentioned
        assert "company_name" in prompt
        assert "revenue" in prompt
        assert "is_public" in prompt

        # Check all descriptions are included
        assert "Name of the company" in prompt
        assert "Annual revenue in millions" in prompt
        assert "Whether company is publicly traded" in prompt

        # Check types are mentioned
        assert "(string)" in prompt
        assert "(number)" in prompt
        assert "(boolean)" in prompt

    def test_prompt_contains_search_strategy(self):
        """Test that prompt contains search strategy instructions."""
        attributes = {
            "test_field": AttributeDefinition(
                description="Test field",
                type="string"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "Search Strategy" in prompt or "search" in prompt.lower()
        assert "search tool" in prompt.lower()

    def test_prompt_contains_extraction_rules(self):
        """Test that prompt contains extraction rules."""
        attributes = {
            "test_field": AttributeDefinition(
                description="Test field",
                type="string"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "Extraction Rules" in prompt or "rules" in prompt.lower()
        assert "not found" in prompt.lower()

    def test_prompt_contains_not_found_instruction(self):
        """Test that prompt instructs to use 'not found' for missing values."""
        attributes = {
            "test_field": AttributeDefinition(
                description="Test field",
                type="string"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "not found" in prompt.lower()
        assert 'use "not found"' in prompt.lower() or "not found" in prompt

    def test_prompt_type_specific_instructions(self):
        """Test that prompt contains type-specific extraction instructions."""
        attributes = {
            "revenue": AttributeDefinition(
                description="Revenue",
                type="number"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        # Check for number type instructions
        assert "number" in prompt.lower()
        assert "numeric" in prompt.lower() or "21.4" in prompt

    def test_prompt_array_handling(self):
        """Test that prompt mentions array handling."""
        attributes = {
            "locations": AttributeDefinition(
                description="Office locations",
                type="array"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "array" in prompt.lower()
        assert "[]" in prompt or "empty array" in prompt.lower()

    def test_prompt_prevents_hallucination(self):
        """Test that prompt instructs not to make up values."""
        attributes = {
            "test_field": AttributeDefinition(
                description="Test field",
                type="string"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        # Check for hallucination prevention
        assert "never make up" in prompt.lower() or "not explicitly" in prompt.lower()
        assert "clearly stated" in prompt.lower() or "explicitly" in prompt.lower()

    def test_prompt_default_type(self):
        """Test prompt generation when type is not specified (defaults to string)."""
        # Create mock attribute without type
        class MockAttributeDef:
            def __init__(self):
                self.description = "Test description"

        attributes = {
            "test_field": MockAttributeDef()
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "test_field" in prompt
        assert "Test description" in prompt
        assert "(string)" in prompt  # Should default to string

    def test_prompt_structure(self):
        """Test that prompt has expected structure."""
        attributes = {
            "company_name": AttributeDefinition(
                description="Name of company",
                type="string"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        # Check for main sections
        assert "task" in prompt.lower() or "extract" in prompt.lower()
        assert "search" in prompt.lower()
        assert "rules" in prompt.lower() or "extraction" in prompt.lower()

    def test_prompt_mentions_multiple_searches(self):
        """Test that prompt allows multiple search queries."""
        attributes = {
            "test_field": AttributeDefinition(
                description="Test field",
                type="string"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "multiple" in prompt.lower() or "different queries" in prompt.lower()

    def test_prompt_with_array_type_shows_empty_array(self):
        """Test that array type shows empty array [] for not found."""
        attributes = {
            "tags": AttributeDefinition(
                description="List of tags",
                type="array"
            )
        }

        prompt = PromptBuilder.build_extraction_prompt(attributes)

        assert "[]" in prompt or "empty array" in prompt.lower()

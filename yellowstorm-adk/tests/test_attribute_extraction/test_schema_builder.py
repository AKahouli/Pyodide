"""Tests for SchemaBuilder utility."""

import pytest
from src.attribute_extraction.utilities.schema_builder import SchemaBuilder
from src.attribute_extraction.schema.models import AttributeDefinition


class TestSchemaBuilder:
    """Test cases for SchemaBuilder utility."""

    def test_build_from_attributes_simple_string(self):
        """Test building schema from simple string attribute."""
        attributes = {
            "company_name": AttributeDefinition(
                description="Name of the company",
                type="string"
            )
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        assert schema["type"] == "json_schema"
        assert schema["json_schema"]["strict"] is True
        assert "company_name" in schema["json_schema"]["schema"]["properties"]
        assert schema["json_schema"]["schema"]["properties"]["company_name"]["type"] == "string"
        assert "company_name" in schema["json_schema"]["schema"]["required"]

    def test_build_from_attributes_number_type(self):
        """Test building schema with number type."""
        attributes = {
            "revenue": AttributeDefinition(
                description="Annual revenue in millions",
                type="number"
            )
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        # Number types use anyOf to allow both number and "not found" string
        revenue_prop = schema["json_schema"]["schema"]["properties"]["revenue"]
        assert "anyOf" in revenue_prop
        assert {"type": "number"} in revenue_prop["anyOf"]
        assert {"type": "string", "enum": ["not found"]} in revenue_prop["anyOf"]
        assert revenue_prop["description"] == "Annual revenue in millions"

    def test_build_from_attributes_boolean_type(self):
        """Test building schema with boolean type."""
        attributes = {
            "is_public": AttributeDefinition(
                description="Whether company is publicly traded",
                type="boolean"
            )
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        # Boolean types use anyOf to allow both boolean and "not found" string
        is_public_prop = schema["json_schema"]["schema"]["properties"]["is_public"]
        assert "anyOf" in is_public_prop
        assert {"type": "boolean"} in is_public_prop["anyOf"]
        assert {"type": "string", "enum": ["not found"]} in is_public_prop["anyOf"]

    def test_build_from_attributes_array_type(self):
        """Test building schema with array type."""
        attributes = {
            "locations": AttributeDefinition(
                description="List of office locations",
                type="array"
            )
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        props = schema["json_schema"]["schema"]["properties"]["locations"]
        assert props["type"] == "array"
        assert props["items"] == {"type": "string"}

    def test_build_from_attributes_multiple_fields(self):
        """Test building schema with multiple attributes."""
        attributes = {
            "company_name": AttributeDefinition(
                description="Name of the company",
                type="string"
            ),
            "revenue": AttributeDefinition(
                description="Annual revenue",
                type="number"
            ),
            "is_public": AttributeDefinition(
                description="Is publicly traded",
                type="boolean"
            )
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        props = schema["json_schema"]["schema"]["properties"]
        assert len(props) == 3
        assert "company_name" in props
        assert "revenue" in props
        assert "is_public" in props

        required = schema["json_schema"]["schema"]["required"]
        assert len(required) == 3
        assert "company_name" in required

    def test_build_from_attributes_default_string_type(self):
        """Test that default type is string if not specified."""
        # Create a mock object without type attribute
        class MockAttributeDef:
            def __init__(self):
                self.description = "Test description"

        attributes = {
            "test_field": MockAttributeDef()
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        assert schema["json_schema"]["schema"]["properties"]["test_field"]["type"] == "string"

    def test_build_search_tool_schema(self):
        """Test building search tool function schema."""
        schema = SchemaBuilder.build_search_tool_schema()

        assert schema["type"] == "function"
        assert schema["function"]["name"] == "search_documents"
        assert schema["function"]["strict"] is True
        assert "query" in schema["function"]["parameters"]["properties"]
        assert schema["function"]["parameters"]["properties"]["query"]["type"] == "string"
        assert "query" in schema["function"]["parameters"]["required"]
        assert schema["function"]["parameters"]["additionalProperties"] is False

    def test_schema_structure_validity(self):
        """Test that generated schema has correct OpenAI structure."""
        attributes = {
            "test_field": AttributeDefinition(
                description="Test field",
                type="string"
            )
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        # Verify top-level structure
        assert "type" in schema
        assert "json_schema" in schema

        # Verify json_schema structure
        json_schema = schema["json_schema"]
        assert "name" in json_schema
        assert "description" in json_schema
        assert "strict" in json_schema
        assert "schema" in json_schema

        # Verify schema structure
        inner_schema = json_schema["schema"]
        assert inner_schema["type"] == "object"
        assert "properties" in inner_schema
        assert "required" in inner_schema
        assert inner_schema["additionalProperties"] is False

    def test_schema_name_and_description(self):
        """Test that schema has correct name and description."""
        attributes = {
            "test": AttributeDefinition(description="Test", type="string")
        }

        schema = SchemaBuilder.build_from_attributes(attributes)

        assert schema["json_schema"]["name"] == "value_extraction"
        assert schema["json_schema"]["description"] == "Extract specified values from documents"

    def test_calculator_tool_schema(self):
        """Test that calculator tool schema is correctly built."""
        schema = SchemaBuilder.build_calculator_tool_schema()

        # Verify structure
        assert schema["type"] == "function"
        assert "function" in schema

        # Verify function details
        function = schema["function"]
        assert function["name"] == "calculator"
        assert "calculate" in function["description"].lower() or "math" in function["description"].lower()
        assert function["strict"] is True

        # Verify parameters
        parameters = function["parameters"]
        assert parameters["type"] == "object"
        assert "expression" in parameters["properties"]
        assert parameters["required"] == ["expression"]
        assert parameters["additionalProperties"] is False

        # Verify expression parameter
        expression_param = parameters["properties"]["expression"]
        assert expression_param["type"] == "string"
        assert "description" in expression_param

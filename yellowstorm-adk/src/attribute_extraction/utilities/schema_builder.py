"""Utility for building OpenAI structured output schemas from attribute definitions."""

from typing import Dict, Any


class SchemaBuilder:
    """Builds OpenAI JSON schemas for structured output from attribute definitions."""

    @staticmethod
    def build_from_attributes(attributes: Dict[str, Any]) -> Dict:
        """
        Generate a structured output JSON schema from attribute definitions.

        Args:
            attributes: Dict mapping attribute names to AttributeDefinition objects
                       Each definition has: description (str) and type (str)

        Returns:
            OpenAI structured output schema in the format:
            {
                "type": "json_schema",
                "json_schema": {
                    "name": "value_extraction",
                    "description": "Extract specified values from documents",
                    "strict": True,
                    "schema": {...}
                }
            }

        Example:
            >>> attributes = {
            ...     "company_name": AttributeDefinition(description="Name", type="string"),
            ...     "revenue": AttributeDefinition(description="Revenue in millions", type="number")
            ... }
            >>> schema = SchemaBuilder.build_from_attributes(attributes)
        """
        properties = {}
        required = []

        for attr_name, attr_def in attributes.items():
            # Extract type and description from AttributeDefinition
            attr_type = attr_def.type if hasattr(attr_def, 'type') else "string"
            attr_description = attr_def.description if hasattr(attr_def, 'description') else ""

            # For non-string types, use anyOf to allow both the actual type and "not found" string
            if attr_type == "string":
                properties[attr_name] = {
                    "type": "string",
                    "description": attr_description
                }
            elif attr_type == "number":
                properties[attr_name] = {
                    "anyOf": [
                        {"type": "number"},
                        {"type": "string", "enum": ["not found"]}
                    ],
                    "description": attr_description
                }
            elif attr_type == "boolean":
                properties[attr_name] = {
                    "anyOf": [
                        {"type": "boolean"},
                        {"type": "string", "enum": ["not found"]}
                    ],
                    "description": attr_description
                }
            elif attr_type == "array":
                properties[attr_name] = {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": attr_description
                }
            else:
                # Default fallback for unknown types
                properties[attr_name] = {
                    "type": attr_type,
                    "description": attr_description
                }

            required.append(attr_name)

        return {
            "type": "json_schema",
            "json_schema": {
                "name": "value_extraction",
                "description": "Extract specified values from documents",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": False
                }
            }
        }

    @staticmethod
    def build_search_tool_schema() -> Dict:
        """
        Create OpenAI function schema for document search tool.

        Returns:
            OpenAI function calling schema for search_documents tool
        """
        return {
            "type": "function",
            "function": {
                "name": "search_documents",
                "description": "Search through uploaded documents for relevant information. Use this when you need to find specific information in the knowledge base.",
                "strict": True,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query to find relevant information in documents"
                        }
                    },
                    "required": ["query"],
                    "additionalProperties": False
                }
            }
        }

    @staticmethod
    def build_calculator_tool_schema() -> Dict:
        """
        Create OpenAI function schema for calculator tool.

        Returns:
            OpenAI function calling schema for calculator tool
        """
        return {
            "type": "function",
            "function": {
                "name": "calculator",
                "description": "Evaluate mathematical expressions to compute derived values. Use this when you need to perform calculations on extracted values (e.g., ratios, averages, sums). Supports: +, -, *, /, **, %, sqrt().",
                "strict": True,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "Mathematical expression to evaluate (e.g., '(revenue - costs) / revenue', 'sqrt(16)', '2.5 * 1.3')"
                        }
                    },
                    "required": ["expression"],
                    "additionalProperties": False
                }
            }
        }

    @staticmethod
    def build_document_chunks_tool_schema() -> Dict:
        """
        Create OpenAI function schema for document chunks tool.

        Returns:
            OpenAI function calling schema for get_document_chunks tool
        """
        return {
            "type": "function",
            "function": {
                "name": "get_document_chunks",
                "description": "Retrieve the first chunks of a document for generating descriptions. Use this when you need to generate a brief description of a document.",
                "strict": True,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chunks": {
                            "type": "integer",
                            "description": "Number of chunks to retrieve (default: 1)"
                        }
                    },
                    "required": ["chunks"],
                    "additionalProperties": False
                }
            }
        }

    @staticmethod
    def has_description_attribute(attributes: Dict[str, Any]) -> bool:
        """
        Check if the attributes dictionary contains a 'description' key.

        Args:
            attributes: Dict mapping attribute names to AttributeDefinition objects

        Returns:
            True if 'description' is one of the attribute names, False otherwise
        """
        return "description" in attributes

"""Utility for building system prompts for attribute extraction."""

from typing import Dict, Any


class PromptBuilder:
    """Builds system prompts for attribute extraction tasks."""

    @staticmethod
    def build_extraction_prompt(attributes: Dict[str, Any]) -> str:
        """
        Generate a system prompt for value extraction based on attributes.

        Args:
            attributes: Dict mapping attribute names to AttributeDefinition objects
                       Each definition has: description (str) and type (str)

        Returns:
            System prompt string with extraction instructions

        Example:
            >>> attributes = {
            ...     "company_name": AttributeDefinition(description="Name of company", type="string"),
            ...     "revenue": AttributeDefinition(description="Revenue", type="number")
            ... }
            >>> prompt = PromptBuilder.build_extraction_prompt(attributes)
        """
        # Build list of attributes to extract
        attr_descriptions = []
        for attr_name, attr_def in attributes.items():
            attr_type = attr_def.type if hasattr(attr_def, 'type') else "string"
            attr_description = attr_def.description if hasattr(attr_def, 'description') else ""
            attr_descriptions.append(f"- {attr_name} ({attr_type}): {attr_description}")

        attrs_list = "\n".join(attr_descriptions)

        return f"""You are a document analysis assistant with access to search and calculator tools.

Your task is to extract the following information from documents:
{attrs_list}

Search Strategy:
1. ALWAYS use the search tool to find relevant information
2. Start with broad queries using key terms from the attributes
3. If no results found, try simpler or alternative search terms
4. You can call the search tool multiple times with different queries
5. Combine information from multiple search results if needed

Calculator Tool:
- Use the calculator tool when an attribute requires computation from extracted values
- For example: if you need to calculate a ratio, percentage, or derived metric from values found in documents
- Call calculator AFTER extracting the base values needed for the computation
- Example: if you extract revenue=100 and costs=40, use calculator("(100-40)/100") to compute profit margin

Extraction Rules:
- Only extract information that is clearly stated in the search results
- If a value is NOT found in the search results, use "not found" as the value
- For number types: extract single numeric values (e.g., 21.4, not "21.4x"). If not found, use the string "not found"
- For string types: provide concise text values. If not found, use "not found"
- For boolean types: use true/false. If not found, use the string "not found"
- For array types: provide a list of values. If not found, use an empty array []
- For computed values: use the calculator tool with the appropriate expression
- Be precise and accurate with the extracted information
- Never make up or infer values that are not explicitly in the documents"""

    @staticmethod
    def build_extraction_prompt_with_description(attributes: Dict[str, Any]) -> str:
        """
        Generate a system prompt for value extraction that includes description generation.

        Args:
            attributes: Dict mapping attribute names to AttributeDefinition objects
                       Each definition has: description (str) and type (str)
                       Dictionary should NOT contain 'description' key (it's handled separately)

        Returns:
            System prompt string with extraction and description instructions
        """
        # Build list of regular attributes to extract (exclude description)
        attr_descriptions = []
        for attr_name, attr_def in attributes.items():
            attr_type = attr_def.type if hasattr(attr_def, 'type') else "string"
            attr_description = attr_def.description if hasattr(attr_def, 'description') else ""
            attr_descriptions.append(f"- {attr_name} ({attr_type}): {attr_description}")

        attrs_list = "\n".join(attr_descriptions) if attr_descriptions else "No additional attributes to extract"

        return f"""You are a document analysis assistant with access to search, calculator, and document chunks tools.

Your task has two parts:
1. Generate a document description using the get_document_chunks tool
2. Extract the following information from documents:
{attrs_list}

Document Description Strategy:
- Use get_document_chunks tool to retrieve first chunk of document (default: 1)
- Analyze the chunk content to generate a brief description of the document
- Focus on the document's purpose, content type, and key topics
- The description should be concise but informative

Search Strategy:
- Use search_documents tool for finding specific information for other attributes
- Start with broad queries using key terms from the attributes
- If no results found, try simpler or alternative search terms
- You can call search_documents multiple times with different queries
- Combine information from multiple search results if needed

Calculator Tool:
- Use the calculator tool when an attribute requires computation from extracted values
- For example: if you need to calculate a ratio, percentage, or derived metric from values found in documents
- Call calculator AFTER extracting the base values needed for the computation

Extraction Rules:
- For description: Analyze document chunks and provide a concise summary focusing on document purpose and content
- For other attributes: Only extract information clearly stated in search results
- If a value is NOT found in the search results, use "not found" as the value
- For number types: extract single numeric values (e.g., 21.4, not "21.4x"). If not found, use the string "not found"
- For string types: provide concise text values. If not found, use "not found"
- For boolean types: use true/false. If not found, use the string "not found"
- For array types: provide a list of values. If not found, use an empty array []
- For computed values: use the calculator tool with the appropriate expression
- Be precise and accurate with the extracted information
- Never make up or infer values that are not explicitly in the documents"""

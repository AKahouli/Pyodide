"""
Search Tools Module

Provides search tool classes and utility functions for Google ADK integration.
"""

from typing import Dict, List, Optional, Union
from google.adk.tools import FunctionTool
from google.genai import types
from typing_extensions import override


class SearchToolADK(FunctionTool):
    """
    Custom FunctionTool for Google ADK that uses pre-built JSON schemas.
    
    This class extends Google ADK's FunctionTool to work with custom schemas
    for search functionality.
    """
    
    def __init__(self, func, schema: dict, *, require_confirmation=False, reject_unknown_args=False):
        """
        Initialize SearchToolADK with function and schema.

        Args:
            func: The function to wrap
            schema: Dictionary containing the function schema
            require_confirmation: bool or predicate — when truthy, FunctionTool
                gates the call on a human confirmation (see google.adk
                function_tool.py): the first invocation raises an
                `adk_request_confirmation` interrupt instead of running, and the
                tool only runs once resumed with a confirmed ToolConfirmation.
        """
        # Call FunctionTool base __init__ with just func; name/description handled upstream
        super().__init__(func, require_confirmation=require_confirmation)
        self.custom_schema = schema["function"]
        self.reject_unknown_args = reject_unknown_args

    async def run_async(self, *, args, tool_context):
        if self.reject_unknown_args:
            allowed = self.custom_schema.get("parameters", {}).get("properties", {})
            if any(key not in allowed or (key.startswith("_") and key != "_display_purpose") for key in args):
                return {"error": "The tool call contains parameters outside its declared schema."}
        return await super().run_async(args=args, tool_context=tool_context)

    @override
    def _get_declaration(self) -> types.FunctionDeclaration:
        """
        Override default introspection with pre-built JSON schema.
        
        Returns:
            types.FunctionDeclaration: Function declaration for Google ADK
        """
        # Parse into Pydantic model
        return types.FunctionDeclaration(**self.custom_schema)


def get_transformed_ids_by_names(attribute_mapping: Dict, names: Optional[Union[str, List[str]]] = None) -> List[str]:
    """
    Extracts transformed IDs for given brain names from the attribute mapping.
    If no names are provided, returns all IDs from the "name" mapping.

    Args:
        attribute_mapping: A dict mapping attributes (like "name") to lists of transformed IDs.
        names: A list of brain names or a single name (string). If None or empty, all IDs are returned.

    Returns:
        List of transformed IDs.
        
    Examples:
        >>> mapping = {"name": {"brain1": ["id1", "id2"], "brain2": ["id3"]}}
        >>> get_transformed_ids_by_names(mapping, "brain1")
        ['id1', 'id2']
        >>> get_transformed_ids_by_names(mapping, ["brain1", "brain2"])
        ['id1', 'id2', 'id3']
        >>> get_transformed_ids_by_names(mapping)
        ['id1', 'id2', 'id3']
    """
    # Get the "name" mapping safely
    name_map = attribute_mapping.get("name", {})

    # Normalize 'names' to always be a list of strings
    if isinstance(names, str):
        names = [names]
    elif names is None or names == [None]:
        names = []

    # If no names provided, return all transformed IDs
    if not names:
        all_ids = []
        for ids in name_map.values():
            all_ids.extend(ids)
        return all_ids

    # Otherwise, collect only matching IDs
    filtered_ids = []
    for name in names:
        filtered_ids.extend(name_map.get(name, []))

    return filtered_ids


def create_search_schema(name: str, description: str, properties: Dict, required: List[str]) -> Dict:
    """
    Create a standardized search schema for ADK tools.
    
    Args:
        name: Function name
        description: Function description
        properties: Schema properties
        required: Required parameters
        
    Returns:
        Dictionary containing the complete schema
    """
    return {
        "function": {
            "name": name,
            "strict": True,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False
            }
        }
    }


def validate_search_parameters(params: Dict, schema: Dict) -> bool:
    """
    Validate search parameters against a schema.
    
    Args:
        params: Parameters to validate
        schema: Schema to validate against
        
    Returns:
        bool: True if parameters are valid
    """
    try:
        required_params = schema.get("function", {}).get("parameters", {}).get("required", [])
        for param in required_params:
            if param not in params:
                return False
        return True
    except Exception:
        return False


def get_attribute_mapping_info(attribute_mapping: Dict) -> Dict:
    """
    Get information about the attribute mapping structure.
    
    Args:
        attribute_mapping: The attribute mapping dictionary
        
    Returns:
        Dictionary with mapping information
    """
    info = {
        "total_attributes": len(attribute_mapping),
        "attributes": list(attribute_mapping.keys()),
        "total_values": 0,
        "total_ids": 0
    }
    
    for attr, values in attribute_mapping.items():
        info["total_values"] += len(values)
        for value_ids in values.values():
            info["total_ids"] += len(value_ids)
    
    return info


class SearchResultProcessor:
    """
    Utility class for processing search results.
    """
    
    @staticmethod
    def deduplicate_by_id(results: List[Dict]) -> List[Dict]:
        """
        Remove duplicate results based on ID.
        
        Args:
            results: List of search results
            
        Returns:
            Deduplicated list of results
        """
        seen_ids = set()
        deduplicated = []
        
        for result in results:
            result_id = result.get("id") or result.get("metadata", {}).get("id")
            if result_id and result_id not in seen_ids:
                seen_ids.add(result_id)
                deduplicated.append(result)
            elif not result_id:
                # Include results without IDs
                deduplicated.append(result)
        
        return deduplicated
    
    @staticmethod
    def format_search_response(results: List[Dict], query: str) -> Dict:
        """
        Format search results into a standardized response.
        
        Args:
            results: Raw search results
            query: Original search query
            
        Returns:
            Formatted response dictionary
        """
        return {
            "query": query,
            "total_results": len(results),
            "results": results,
            "timestamp": None  # Could add timestamp if needed
        }
    
    @staticmethod
    def extract_metadata_fields(results: List[Dict], fields: List[str]) -> List[Dict]:
        """
        Extract specific metadata fields from search results.
        
        Args:
            results: Search results
            fields: Fields to extract from metadata
            
        Returns:
            Results with only specified metadata fields
        """
        extracted = []
        
        for result in results:
            metadata = result.get("metadata", {})
            filtered_metadata = {field: metadata.get(field) for field in fields if field in metadata}
            
            extracted_result = {
                "page_content": result.get("page_content", ""),
                "metadata": filtered_metadata
            }
            extracted.append(extracted_result)
        
        return extracted

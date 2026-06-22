"""
Search Toolkit Module

Main toolkit for handling different types of searches including document search,
brain search, in-memory search, and web search integration.

All search functions are optimized for parallel execution with proper async/await
and yielding behavior for concurrent operations.
"""

import asyncio
import copy
import re
from typing import Dict, List, Optional, Set, Any, Callable

import fitz

from src.logger.logging import get_logger
from .web_search import WebSearchTool
from .. import CommonHelpers, get_transformed_ids_by_names
from src.smart_rag.tools.utilities.esg_helpers import (
                num_patternsearch,
                ar_patternsearch,
                semantic_search,
                detect_pattern_and_extract_args
            )

logger = get_logger("api.smart_rag.tools.search_toolkit")

_OBJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")


class SearchToolkit:
    """
    Comprehensive search toolkit that combines document search, brain search,
    in-memory document extraction, and web search capabilities.
    """

    def __init__(self, task_order, workspace_name: List[str] = None,
                 brain_id: List[str] = None, top_k: int = 4,
                 vectorstore: str = "vectorstoredev2", attribute_mapping: Dict = None,
                 brain_attribute_mapping: Dict = None, search_web: Optional[str] = "off",
                 search_type: str = "vector_search", citation_manager=None,
                 user_id: Optional[str] = None):
        """
        Initialize SearchToolkit.

        Args:
            task_order: Task order for reference numbering
            workspace_name: List of workspace names to search
            brain_id: Compatibility alias for workspace_name
            top_k: Number of top results to return
            vectorstore: Vectorstore name
            attribute_mapping: Document attribute mapping
            brain_attribute_mapping: Brain attribute mapping
            search_web: Web search mode ("standard", "deep", or "off")
            search_type: Type of search to perform ("vector_search" or "hybrid_search")
            citation_manager: Optional SessionCitationManager for numeric citations
            user_id: Optional user ID for search context and logging
        """
        self.workspace_name = workspace_name if workspace_name is not None else brain_id or []
        self.brain_id = self.workspace_name
        self.top_k = top_k
        self.vectorstore = vectorstore
        self.task_order = task_order
        self.search_web = search_web
        self.search_type = search_type
        self.user_id = user_id

        # Initialize sources tracking
        self.sources_text: List = []
        self.sources_image: List = []
        self.ids: Set = set()

        # Initialize mappings
        self.attribute_mapping = attribute_mapping if attribute_mapping is not None else {}
        self.brain_attribute_mapping = brain_attribute_mapping if brain_attribute_mapping is not None else {}

        # Initialize helpers
        self.common_helpers = CommonHelpers()
        self.web_search_tool = WebSearchTool() if search_web != "off" else None
        self.in_memory_documents = {}
        self.response_id:int = 0

        # Citation manager for numeric citations
        if citation_manager is None:
            # Use simple incrementing counter fallback
            self.citation_manager = None
            self.use_numeric_citations = True
            self._citation_counter = 0  # Simple counter for fallback citations
            logger.warning("Using simple citation counter fallback - citations will not persist across requests")
        else:
            self.citation_manager = citation_manager
            self.use_numeric_citations = True

        # Additional tracking for numeric citations
        if self.use_numeric_citations:
            self.cached_text_sources = []  # Store clean text sources
            self.cached_image_sources = []  # Store clean image sources

        # Track page-to-reference mappings for multi-page content
        self.page_reference_map = {}  # Maps source_id to {page_number: reference}

    async def perform_standard_search(self, query: str) -> Dict:
        """
        Standard Search: Retrieves information from all available documents at once.

        This function is optimized for parallel execution - call multiple times for different queries.

        Args:
            query: The search query string.

        Returns:
            Dictionary with sources_text, sources_image, and list_of_filenames.
        """
        try:
            # Yield control to allow parallel execution
            await asyncio.sleep(0)

            if not self.workspace_name:
                return self._empty_search_result()

            resp_id = self.response_id
            self.response_id += 1
            # Perform text and image searches in parallel
            text_task = asyncio.create_task(self._search_text_documents(query))
            image_task = asyncio.create_task(self._search_image_documents(query))

            text_results, image_results = await asyncio.gather(text_task, image_task)

            # Ensure results are not None before accessing
            if text_results is None:
                text_results = {"content": []}
            if image_results is None:
                image_results = {"wrapped_images": [], "image_references": []}

            return {
                "sources_text": text_results.get("content", []),
                "sources_image": image_results.get("wrapped_images", []),
                "list_of_filenames": image_results.get("image_references", []),
                "response_id": resp_id
            }

        except Exception as e:
            logger.exception(f"Error in perform_standard_search: {e}")
            return self._empty_search_result()

    async def perform_filtered_search(self, query: str, file_names: List[str]) -> Dict:
        """
        Filtered Search: Retrieves information from specific documents by file name.

        Args:
            query: The search query string.
            file_names: List of file names to filter search.

        Returns:
            Dictionary with sources_text, sources_image, and list_of_filenames.
        """
        try:
            if not file_names:
                # If no file_names provided, fallback to standard search
                # This path requires workspace names.
                if not self.workspace_name:
                    return self._empty_search_result()
                return await self.perform_standard_search(query)

            search_file_names = self._resolve_search_file_names(file_names)

            # Perform text and image searches with filtered file names
            text_results = await self._search_text_documents(query, filtered_filenames=search_file_names)
            image_results = await self._search_image_documents(query, filtered_filenames=search_file_names)
            resp_id=self.response_id
            self.response_id+=1
            return {
                "sources_text": text_results["content"],
                "sources_image": image_results["wrapped_images"],
                "list_of_filenames": image_results["image_references"],
                "response_id": resp_id
            }

        except Exception as e:
            logger.exception(f"Error in perform_filtered_search: {e}")
            return self._empty_search_result()

    def _resolve_search_file_names(self, file_names: List[str]) -> List[str]:
        file_name_by_id = self.attribute_mapping.get("_file_name_by_id", {})
        resolved_file_names = []
        seen_file_names = set()
        for file_name in file_names or []:
            normalized = str(file_name or "").strip()
            if not normalized:
                continue
            resolved = str(file_name_by_id.get(normalized) or normalized).strip()
            if _OBJECT_ID_RE.fullmatch(resolved):
                logger.warning(
                    "Skipping unresolved document id for Qdrant file_name filter: %s",
                    resolved,
                )
                continue
            if resolved and resolved not in seen_file_names:
                resolved_file_names.append(resolved)
                seen_file_names.add(resolved)
        return resolved_file_names

    async def perform_document_search(self, query: str, **filters) -> Dict:
        """
        Search within specific documents based on filters.

        This function is optimized for parallel execution - call multiple times for different queries.

        Args:
            query: Search query
            **filters: Additional filter parameters

        Returns:
            Dictionary with search results
        """
        filters={k: v for k, v in filters.items() if v is not None}
        # Remove filters with None values to avoid applying empty filters in the search.
        logger.info(f"Performing document search with filters: {filters}")
        try:
            # Yield control to allow parallel execution
            await asyncio.sleep(0)

            if not self.workspace_name:
                return self._empty_search_result()

            # Extract chunks filter if present
            chunks_limit = filters.pop("chunks", None)

            # Apply filters to get specific document IDs
            filtered_ids = self.common_helpers.filter_ids(filters, self.attribute_mapping)

            if filtered_ids:
                list_of_filtered_ids = self._resolve_search_file_names(list(filtered_ids))
                self.ids.update(filtered_ids)

                # Execute text and image searches in parallel
                text_task = asyncio.create_task(self._search_text_documents(query, list_of_filtered_ids))
                image_task = asyncio.create_task(self._search_image_documents(query, list_of_filtered_ids))
                text_results, image_results = await asyncio.gather(text_task, image_task)
            else:
                # Execute text and image searches in parallel
                text_task = asyncio.create_task(self._search_text_documents(query))
                image_task = asyncio.create_task(self._search_image_documents(query))
                text_results, image_results = await asyncio.gather(text_task, image_task)

            # Apply chunks limit if specified
            if chunks_limit and text_results.get("content"):
                text_results["content"] = text_results["content"][:chunks_limit]

            resp_id = self.response_id
            self.response_id += 1
            return {
                "sources_text": text_results["content"],
                "sources_image": image_results["wrapped_images"],
                "list_of_filenames": image_results["image_references"],
                "response_id": resp_id
            }

        except Exception as e:
            logger.exception(f"Error in perform_document_search: {e}")
            return self._empty_search_result()

    async def preform_all_brain_search(self, query: str, brain_name: str = None,
                                     document_filter: str = None) -> Dict:
        """
        Search within specific brains/knowledge bases.

        Args:
            query: Search query
            brain_name: Specific brain to search in
            document_filter: Filter by specific documents

        Returns:
            Dictionary with search results
        """
        try:
            if not self.workspace_name:
                return self._empty_search_result()

            # Filter by brain name if specified
            if brain_name and self.brain_attribute_mapping:
                brain_ids = get_transformed_ids_by_names(self.brain_attribute_mapping, brain_name)
                if brain_ids:
                    self.ids.update(brain_ids)

            # Apply document filter if specified
            if document_filter and self.brain_attribute_mapping:
                doc_mapping = self.brain_attribute_mapping.get("documents", {})
                if document_filter in doc_mapping:
                    self.ids.update(doc_mapping[document_filter])

            return await self.perform_standard_search(query)

        except Exception as e:
            logger.exception(f"Error in preform_all_brain_search: {e}")
            return self._empty_search_result()

    async def perform_in_memory_extraction(self, file_name: str) -> str:
        """
        Extract complete content from an in-memory document.

        Args:
            file_name: Name of the file to extract

        Returns:
            Formatted content of the document
        """
        try:
            if not file_name:
                return "No file name specified for in-memory extraction."

            # Check if file exists in in-memory documents
            file_path = self.in_memory_documents.get(file_name)
            if not file_path:
                available_files = list(self.in_memory_documents.keys())
                return f"File '{file_name}' not found in memory. Available files: {available_files}"

            # Download and extract file content
            try:
                output_path = await self.common_helpers.async_download_from_azure_datalake(file_path)
            except Exception as download_error:
                return f"##### {file_name}\n\nDownload error: {str(download_error)}\n\n#####\n\n"

            try:
                with fitz.open(output_path) as doc:
                    content = "\n".join(page.get_text() for page in doc)

                if not content.strip():
                    return f"File '{file_name}' contains no extractable content."

                return f"##### {file_name}\n\n{content}\n\n#####\n\n"

            except Exception as read_error:
                logger.exception(f"File reading error '{file_name}': {read_error}")
                return f"##### {file_name}\n\nFile reading error: {str(read_error)}\n\n#####\n\n"

        except Exception as e:
            logger.exception(f"Error in perform_in_memory_extraction for file {file_name}: {e}")
            return f"##### In-memory extraction error\n\nUnexpected error accessing file '{file_name}': {str(e)}\n\n#####\n\n"

    async def perform_web_search(self, query: str) -> Dict:
        """
        Perform web search using the LinkUp API.

        Args:
            query: Search query

        Returns:
            Dict with 'text' (search results for agent) and 'sources' (structured source list)
        """
        if not self.web_search_tool:
            return {
                "text": "Web search is not enabled.",
                "sources": []
            }

        try:
            # Returns dict with 'text' and 'sources'
            result = await self.web_search_tool.perform_web_search(query)
            logger.info(f"[WEB SEARCH] Query: {query}, Sources: {len(result.get('sources', []))}")
            return result
        except Exception as e:
            logger.error(f"Web search failed: {str(e)}")
            return {
                "text": f"Web search error: {str(e)}",
                "sources": []
            }

    async def perform_csrd_search(self, query: str) -> str:
        """
        Perform CSRD context retrieval using pattern detection and semantic search.

        Args:
            query: The search query (e.g., "E1-29", "E1-AR4-b-IV", or natural language)

        Returns:
            Formatted CSRD context with ESRS, Exigence, DataPoint, and References
        """
        logger.info(f"Starting CSRD search with query: {query}")
        try:
            graph_results = []
            logger.info("Detecting pattern and extracting arguments from query")
            function_name, args = detect_pattern_and_extract_args(query)
            logger.info(f"Detected function: {function_name} with args: {args}")
            available_functions = {
                "num_patternsearch": num_patternsearch,
                "ar_patternsearch": ar_patternsearch,
                "semantic_search": semantic_search
            }

            if function_name in available_functions:
                logger.info(f"Executing {function_name} function")
                result = f"<Task>{query}</Task>\n"
                result += available_functions[function_name](**args)
                graph_results.append(result.replace('–', '-'))
                logger.info("CSRD search completed successfully")
                return str(graph_results)
            else:
                logger.warning(f"Unknown function detected: {function_name}")
                return f"Error: Unable to process query '{query}'"

        except Exception as e:
            logger.exception(f"Error occurred in perform_csrd_search: {e}")
            return f"Error retrieving CSRD context: {str(e)}"


    def set_in_memory_documents(self, doc_tree: List[Dict[str, Any]]):
        """
        Set the list of in-memory documents from doc_tree.

        Args:
            doc_tree: Document tree structure containing documents with filepath information
        """
        try:
            self.in_memory_documents = {}

            for doc in doc_tree:
                if doc.get("filepath"):
                    filename = doc.get("nom", doc.get("filename", "Unknown"))
                    filepath = doc.get("filepath")
                    self.in_memory_documents[filename] = filepath

            logger.info(f"Set {len(self.in_memory_documents)} in-memory documents")

        except Exception as e:
            logger.exception(f"Error setting in-memory documents: {e}")


    def to_valid_identifier(self,name: str) -> str:
        return name.strip().lower().replace(" ", "_").replace("-", "_")

    def generate_search_function(self, schema: dict, retrieve_fn: Callable):
        """Generate function specifically for search operations that require a query parameter."""
        import inspect
        from typing import Optional, List
        from functools import wraps

        properties = schema["parameters"]["properties"]
        required = set(schema["parameters"].get("required", []))

        reverse_mapping = {}
        enum_validators = {}

        # Build the inspect.Signature - always include query as first parameter
        parameters = [
            inspect.Parameter("query", inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=str)
        ]

        for prop_name, prop_info in properties.items():
            if prop_name == "query":
                continue

            param_name = self.to_valid_identifier(prop_name)
            reverse_mapping[param_name] = prop_name

            enum = prop_info.get("items", {}).get("enum")
            if enum:
                enum_validators[param_name] = set(enum)

            parameters.append(
                inspect.Parameter(
                    name=param_name,
                    kind=inspect.Parameter.KEYWORD_ONLY,
                    default=None,
                    annotation=Optional[List[str]]
                )
            )

        signature = inspect.Signature(parameters)

        @wraps(retrieve_fn)
        async def wrapper(*args, **kwargs):
            bound = signature.bind(*args, **kwargs)
            bound.apply_defaults()

            query = bound.arguments["query"]
            filters = {}

            for k, v in bound.arguments.items():
                if k == "query" or v is None:
                    continue
                if k in enum_validators:
                    # Filter out invalid values instead of raising error
                    valid_values = set(v) & enum_validators[k]
                    if valid_values:
                        filters[reverse_mapping[k]] = list(valid_values)
                else:
                    filters[reverse_mapping[k]] = v

            return await retrieve_fn(query=query, **filters)

        wrapper.__signature__ = signature
        wrapper.__annotations__ = {p.name: p.annotation for p in parameters}

        function_tool_schema = {
            "name": schema.get("name", ""),
            "description": schema.get("description", ""),
            "parameters": {
                "type": "object",
                "required": ["query"],
                "properties": {},
                "additionalProperties": False,
            }
        }

        for p in parameters:
            if p.name == "query":
                function_tool_schema["parameters"]["properties"]["query"] = {
                    "type": "string",
                    "description": schema.get("parameters", {}).get("properties", {}).get("query", {}).get(
                        "description", "")
                }
                continue

            original = reverse_mapping[p.name]
            # Get enum values from attribute_mapping if available
            enum_values = []
            if original in self.attribute_mapping:
                enum_values = sorted([k for k in self.attribute_mapping[original] if k is not None])

            # Skip fields with only one enum value
            if len(enum_values) <= 1:
                continue

            items = {"type": "string"}
            if enum_values:
                items["enum"] = enum_values

            function_tool_schema["parameters"]["properties"][original] = {
                "type": "array",
                "items": items,
                "description": f"List of values for attribute: {original}"
            }

            if original in required:
                function_tool_schema["parameters"]["required"].append(original)

        wrapper.__openai_function__ = {
            "type": "function",
            "function": function_tool_schema
        }
        return wrapper, wrapper.__openai_function__

    def generate_generic_function(self, schema: dict, retrieve_fn: Callable):
        """Generate function for non-search operations (like in-memory extraction)."""
        import inspect
        from typing import Optional, List
        from functools import wraps

        properties = schema["parameters"]["properties"]
        required = set(schema["parameters"].get("required", []))

        reverse_mapping = {}
        enum_validators = {}
        parameters = []

        for prop_name, prop_info in properties.items():
            param_name = self.to_valid_identifier(prop_name)
            reverse_mapping[param_name] = prop_name

            # Handle enum validation
            enum = prop_info.get("items", {}).get("enum")
            if enum:
                enum_validators[param_name] = set(enum)

            # Determine parameter type and default value
            param_type = prop_info.get("type", "string")
            is_required = prop_name in required

            # Set annotation based on parameter type
            if param_type == "string":
                if is_required:
                    annotation = str
                    default_value = inspect.Parameter.empty
                else:
                    annotation = Optional[str]
                    default_value = None
            else:
                if not is_required:
                    annotation = Optional[List[str]]
                    default_value = None
                else:
                    annotation = List[str]
                    default_value = inspect.Parameter.empty

            parameters.append(
                inspect.Parameter(
                    name=param_name,
                    kind=inspect.Parameter.KEYWORD_ONLY if not is_required else inspect.Parameter.POSITIONAL_OR_KEYWORD,
                    default=default_value,
                    annotation=annotation
                )
            )

        signature = inspect.Signature(parameters)

        @wraps(retrieve_fn)
        async def wrapper(*args, **kwargs):
            bound = signature.bind(*args, **kwargs)
            bound.apply_defaults()

            call_kwargs = {}

            for param_name, value in bound.arguments.items():
                if value is None:
                    continue

                # Validate enum values if applicable - filter out invalid values instead of raising error
                if param_name in enum_validators:
                    if isinstance(value, list):
                        value = list(set(value) & enum_validators[param_name])
                        if not value:  # Skip if no valid values remain
                            continue
                    elif value not in enum_validators[param_name]:
                        continue  # Skip invalid single value

                # Map back to original parameter name
                original_name = reverse_mapping[param_name]
                call_kwargs[original_name] = value

            return await retrieve_fn(**call_kwargs)

        wrapper.__signature__ = signature
        wrapper.__annotations__ = {p.name: p.annotation for p in parameters}

        function_tool_schema = {
            "name": schema.get("name", ""),
            "description": schema.get("description", ""),
            "parameters": {
                "type": "object",
                "required": list(required),
                "properties": {},
                "additionalProperties": False,
            }
        }

        # Build properties for the schema
        for param in parameters:
            param_name = param.name
            original_name = reverse_mapping[param_name]
            original_prop = properties[original_name]

            if original_prop.get("type") == "string":
                function_tool_schema["parameters"]["properties"][original_name] = {
                    "type": "string",
                    "description": original_prop.get("description", f"Value for parameter: {original_name}")
                }
                # Handle enums for string parameters
                if original_name in enum_validators:
                    function_tool_schema["parameters"]["properties"][original_name]["enum"] = sorted(
                        enum_validators[original_name])
            else:
                # Get enum values from attribute_mapping if available
                enum_values = []
                if hasattr(self, 'attribute_mapping') and original_name in self.attribute_mapping:
                    enum_values = sorted([k for k in self.attribute_mapping[original_name] if k is not None])

                items = {"type": "string"}
                if enum_values:
                    items["enum"] = enum_values

                function_tool_schema["parameters"]["properties"][original_name] = {
                    "type": "array",
                    "items": items,
                    "nullable": True,
                    "description": original_prop.get("description", f"List of values for attribute: {original_name}")
                }

        wrapper.__openai_function__ = {
            "type": "function",
            "function": function_tool_schema
        }

        return wrapper, wrapper.__openai_function__

    def generate_function(self, schema: dict, retrieve_fn: Callable):
        """Main function that routes to appropriate generator based on schema."""
        properties = schema["parameters"]["properties"]

        # If schema has a query parameter, use search function generator
        if "query" in properties:
            return self.generate_search_function(schema, retrieve_fn)
        else:
            return self.generate_generic_function(schema, retrieve_fn)

    async def _search_text_documents(self, query: str, filtered_filenames: Optional[List[str]] = None) -> Dict:
        """Search text documents and process results."""
        try:
            text_payloads = []

            # Ensure filtered_filenames is a list (handle None case explicitly)
            if filtered_filenames is None:
                filtered_filenames = []

            # Ensure self.ids is not None
            if self.ids is None:
                self.ids = set()

            if not filtered_filenames:
                # Unfiltered search requires workspace names.
                if not self.workspace_name:
                    return {"content": []}
                text_filter = {
                    "workspace_id": self.workspace_name,
                    "image": False,
                }
                if self.user_id:
                    text_filter["user_id"] = self.user_id
                text_payload = self.common_helpers.create_search_payload(
                    query, text_filter, self.vectorstore, self.top_k, self.search_type,
                    user_id=self.user_id)
                text_payloads.append(text_payload)
            else:
                # Filtered search by file names - include workspace_id only if available
                for file_name in filtered_filenames:
                    text_filter = {
                        "image": False,
                        "file_name": file_name
                    }
                    # Only include workspace_id if it's not empty
                    if self.workspace_name:
                        text_filter["workspace_id"] = self.workspace_name
                    if self.user_id:
                        text_filter["user_id"] = self.user_id

                    text_payload = self.common_helpers.create_search_payload(
                        query, text_filter, self.vectorstore, self.top_k, self.search_type,
                        user_id=self.user_id)
                    text_payloads.append(text_payload)
            responses_json_text=[]
            if text_payloads:
                for text_payload in text_payloads:
                    response_json_text = await self.common_helpers.post_vectorstore("", text_payload)
                    if response_json_text is not None:
                        responses_json_text.append(response_json_text)

            # Update IDs with results
            for response_json_text in responses_json_text:
                text_ids = [item[0]["metadata"].get("id") for item in response_json_text
                           if item and item[0] and item[0]["metadata"] and item[0]["metadata"].get("id")]
                if text_ids:  # Only update if we got valid IDs
                    self.ids.update(text_ids)

            # Process text results
            response_text_content = []
            for response_json_text in responses_json_text:
                if response_json_text is None:  # Skip None responses
                    continue
                for text_item in response_json_text:
                    if text_item is None or len(text_item) < 1:  # Skip invalid items
                        continue
                    base_page_content = text_item[0]["page_content"]

                    # Check if content has multiple page markers
                    pages = self.split_multi_page_content(base_page_content)

                    if not pages:
                        # Single page content, process as before
                        await self._process_single_page(text_item, response_text_content)
                    else:
                        # Multi-page content, process each page
                        for page_data in pages:
                            await self._process_individual_page(
                                text_item,
                                page_data['page_number'],
                                page_data['content'],
                                response_text_content
                            )

            return {"content": response_text_content}
        except Exception as e:
            logger.error(f"Error in _search_text_documents: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {"content": []}

    async def _search_image_documents(self, query: str, filtered_filenames: Optional[List[str]] = None) -> Dict:
        """Search image documents and process results."""
        try:
            image_payloads=[]

            # Ensure filtered_filenames is a list (handle None case explicitly)
            if filtered_filenames is None:
                filtered_filenames = []

            # Ensure self.ids is not None
            if self.ids is None:
                self.ids = set()

            if not filtered_filenames:
                # Unfiltered search requires workspace names.
                if not self.workspace_name:
                    return {"wrapped_images": [], "image_references": []}
                image_filter = {
                    "workspace_id": self.workspace_name,
                    "image": True,
                }
                if self.user_id:
                    image_filter["user_id"] = self.user_id
                image_payload = self.common_helpers.create_search_payload(
                    query, image_filter, self.vectorstore, self.top_k, self.search_type,
                    user_id=self.user_id)
                image_payloads.append(image_payload)

            else :
                # Filtered search by file names - include workspace_id only if available
                for file_name in filtered_filenames:
                    image_filter = {
                        "image": True,
                        "file_name": file_name
                    }
                    # Only include workspace_id if it's not empty
                    if self.workspace_name:
                        image_filter["workspace_id"] = self.workspace_name
                    if self.user_id:
                        image_filter["user_id"] = self.user_id

                    image_payload = self.common_helpers.create_search_payload(
                        query, image_filter, self.vectorstore, self.top_k, self.search_type,
                        user_id=self.user_id)
                    image_payloads.append(image_payload)

            responses_json_image=[]
            wrapped_images_for_all=[]
            image_references_for_all=[]
            for image_payload in image_payloads:
                response_json_image = await self.common_helpers.post_vectorstore("", image_payload)
                if response_json_image is not None:
                    responses_json_image.append(response_json_image)

            # Update IDs with results
            for response_json_image in responses_json_image:
                image_ids = [item[0]["metadata"].get("id") for item in response_json_image
                            if item and item[0] and item[0]["metadata"] and item[0]["metadata"].get("id")]
                if image_ids:  # Only update if we got valid IDs
                    self.ids.update(image_ids)

                # Process image downloads
                downloaded_image_paths, list_of_filenames = await self.common_helpers.process_image_downloads(
                    response_json_image)

            for i in response_json_image:
                try:
                    image_path = i[0]['metadata'].get('image_path')
                    # Handle None or missing image_path (e.g., from BM25 text results)
                    if image_path:
                        image_filename = image_path.split('/')[-1]
                    else:
                        image_filename = "unknown_image"

                    if self.citation_manager:
                        reference = await self.citation_manager.cite_image_source(self.task_order, image_filename)
                    else:
                        reference = await self._cite_image_source_fallback(self.task_order, image_filename)
                except Exception as e:
                    logger.error(f"Error generating image citation: {e}")
                    reference = f"[{len(image_references_for_all) + 1}]"
                # Collect the reference
                image_references_for_all.append(reference)

                image_obj = self.common_helpers.create_image_object(i)

                if all(existing["object"] != image_obj for existing in self.sources_image):
                    self.sources_image.append({
                        "reference": reference,
                        "object": image_obj
                    })

            # Process downloaded images
            raw_imgs = await self.common_helpers.process_downloaded_images(downloaded_image_paths)
            wrapped_images = self.common_helpers.wrap_images(raw_imgs)
            wrapped_images_for_all.extend(wrapped_images)

            return {
                "wrapped_images": wrapped_images_for_all,
                "image_references": image_references_for_all
            }
        except Exception as e:
            logger.error(f"Error in _search_image_documents: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                "wrapped_images": [],
                "image_references": []
            }

    def _empty_search_result(self) -> Dict:
        """Return empty search result structure."""
        resp_id = self.response_id
        self.response_id += 1
        return {
            "sources_text": [],
            "sources_image": [],
            "list_of_filenames": [],
            "response_id": resp_id
        }

    def get_search_stats(self) -> Dict:
        """
        Get statistics about current search state.
        
        Returns:
            Dictionary with search statistics
        """
        return {
            "total_text_sources": len(self.sources_text),
            "total_image_sources": len(self.sources_image),
            "current_text_order": len(self.sources_text),
            "tracked_ids_count": len(self.ids),
            "workspace_names": self.workspace_name,
            "vectorstore": self.vectorstore,
            "top_k": self.top_k,
            "web_search_enabled": self.search_web != "off"
        }

    def reset_search_state(self):
        """Reset search state for new operations."""
        self.sources_text.clear()
        self.sources_image.clear()
        self.ids.clear()

    def clear_in_memory_documents(self):
        """Clear in-memory documents mapping."""
        self.in_memory_documents.clear()

    def split_multi_page_content(self, page_content: str) -> List[Dict[str, Any]]:
        """
        Split multi-page content into individual pages.
        Preserves the <page number=X> markers in the content.

        Args:
            page_content: Content with <page number=X> markers

        Returns:
            List of dictionaries with 'page_number' and 'content' keys
        """
        # Strict pattern to match <page number=X> markers only
        pattern = r'<page number=(\d+)>(.*?)(?=<page number=\d+>|$)'

        # Find all matches
        matches = re.findall(pattern, page_content, re.DOTALL)

        if not matches:
            # No page markers found, return single page with original page from metadata
            return []

        pages = []
        for page_num, content in matches:
            # Keep the page marker in the content as requested
            full_content = f"<page number={page_num}>{content.strip()}"

            pages.append({
                'page_number': int(page_num),
                'content': full_content
            })

        return pages

    def get_page_reference_mapping(self) -> Dict[str, Dict[int, Any]]:
        """
        Get the mapping of source documents to their page-to-reference mappings.

        Returns:
            Dictionary mapping source_id to {page_number: reference}
        """
        return self.page_reference_map

    async def _process_single_page(self, text_item, response_text_content: List):
        """Process a single page item (existing logic)"""
        # Handle tuple format: (document_data, score)
        if isinstance(text_item, tuple) and len(text_item) == 2:
            document_data, score = text_item
        else:
            # If not a tuple, wrap it
            document_data = text_item
            score = 0.0

        text_obj = self.common_helpers.create_text_object(document_data)

        # Check if this text object already exists
        existing_entry = next(
            (entry for entry in self.sources_text if entry["object"] == text_obj),
            None
        )

        if existing_entry:
            # Reuse existing reference
            reference = existing_entry["reference"]
        else:
            # Get new citation from manager - use the text object as identifier
            try:
                if self.citation_manager:
                    reference = await self.citation_manager.cite_text_source(text_obj, text_obj['content']['page'])
                else:
                    reference = await self._cite_text_source_fallback(text_obj, text_obj['content']['page'])
            except Exception as e:
                logger.error(f"Error generating text citation: {e}")
                reference = f"[{len(self.sources_text) + 1}]"
            self.sources_text.append({
                "reference": reference,
                "object": text_obj
            })

        # Append in the expected dictionary format
        response_text_content.append({
            "page_content": document_data["page_content"],
            "filename": document_data["metadata"]["source"],
            "text_order": len(self.sources_text) - 1,
            "source_reference": reference
        })

    async def _process_individual_page(self, text_item, page_number: int, page_content: str, response_text_content: List):
        """Process an individual page from multi-page content"""
        # Handle tuple format: (document_data, score)
        if isinstance(text_item, tuple) and len(text_item) == 2:
            document_data, score = text_item
        else:
            # If not a tuple, wrap it
            document_data = text_item
            score = 0.0

        # Get source identifier for mapping
        metadata = document_data.get("metadata") or {}
        source_id = metadata.get("file_name") or metadata.get("external_id")

        # Initialize mapping for this source if needed
        if source_id not in self.page_reference_map:
            self.page_reference_map[source_id] = {}

        # Create a modified document_data for this specific page
        modified_document_data = copy.deepcopy(document_data)
        modified_document_data["page_content"] = page_content
        modified_document_data["metadata"]["page"] = page_number

        # Create text object
        text_obj = self.common_helpers.create_text_object(modified_document_data)

        # Check for existing entry considering both source and page
        existing_entry = next(
            (entry for entry in self.sources_text
             if entry["object"]["content"]["source"] == text_obj["content"]["source"]
             and entry["object"]["content"]["page"] == page_number),
            None
        )
        if existing_entry:
            # Reuse existing reference
            reference = existing_entry["reference"]
        else:
            # Get new citation from manager - use the text object as identifier
            try:
                if self.citation_manager:
                    reference = await self.citation_manager.cite_text_source(text_obj, text_obj['content']['page'])
                else:
                    reference = await self._cite_text_source_fallback(text_obj, text_obj['content']['page'])
            except Exception as e:
                logger.error(f"Error generating text citation: {e}")
                reference = f"[{len(self.sources_text) + 1}]"
            self.sources_text.append({
                "reference": reference,
                "object": text_obj
            })

        # Append the individual page content in the expected dictionary format
        response_text_content.append({
            "page_content": page_content,
            "filename": modified_document_data["metadata"]["source"],
            "text_order": len(self.sources_text) - 1,
            "source_reference": reference
        })

    async def _get_next_citation_number(self) -> int:
        """
        Get the next citation number using simple counter.

        Returns:
            int: The next citation number
        """
        self._citation_counter += 1
        return self._citation_counter

    async def _cite_text_source_fallback(self, source_object: dict, page: int = None) -> str:
        """
        Simple fallback for text citation when no citation manager is provided.

        Args:
            source_object: The text source object (ignored in fallback)
            page: Optional page number (ignored in fallback)

        Returns:
            str: Citation string in format [n]
        """
        citation_number = await self._get_next_citation_number()
        return f"[{citation_number}]"

    async def _cite_image_source_fallback(self, task_order: int, image_path: str) -> str:
        """
        Simple fallback for image citation when no citation manager is provided.

        Args:
            task_order: The task order number (ignored in fallback)
            image_path: The image path (ignored in fallback)

        Returns:
            str: Citation string in format [n]
        """
        citation_number = await self._get_next_citation_number()
        return f"[{citation_number}]"


# Factory function for creating SearchToolkit instances
def create_search_toolkit(task_order, brain_id: List[str] = None, top_k: int = 4,
                         vectorstore: str = "vectorstoredev3", attribute_mapping: Dict = None,
                         brain_attribute_mapping: Dict = None,
                         search_web: Optional[str] = "off",
                         search_type: str = "vector_search", citation_manager=None,
                         workspace_name: List[str] = None,
                         user_id: Optional[str] = None) -> SearchToolkit:
    """
    Factory function to create a SearchToolkit instance.

    Args:
        task_order: Task order for reference numbering
        workspace_name: List of workspace names to search
        top_k: Number of top results to return
        vectorstore: Vectorstore name
        attribute_mapping: Document attribute mapping
        brain_attribute_mapping: Brain attribute mapping
        search_web: Web search mode
        search_type: Type of search to perform ("vector_search" or "hybrid_search")
        citation_manager: Optional SessionCitationManager for numeric citations
        user_id: Optional user ID for search context and logging

    Returns:
        SearchToolkit instance
    """
    return SearchToolkit(
        task_order=task_order,
        workspace_name=workspace_name or brain_id,
        top_k=top_k,
        vectorstore=vectorstore,
        attribute_mapping=attribute_mapping,
        brain_attribute_mapping=brain_attribute_mapping,
        search_web=search_web,
        search_type=search_type,
        citation_manager=citation_manager,
        user_id=user_id
    )

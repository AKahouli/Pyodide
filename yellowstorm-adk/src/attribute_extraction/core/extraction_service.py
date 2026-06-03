"""Service for attribute-based value extraction from documents."""

import asyncio
import json
from typing import Dict, Any, List, Optional
from openai import AsyncOpenAI, OpenAI
import httpx
from fastapi import HTTPException

from src.smart_rag.tools.search.toolkit import SearchToolkit
from src.smart_rag.tools.utilities.calculator import calculator
from src.attribute_extraction.utilities.schema_builder import SchemaBuilder
from src.attribute_extraction.utilities.prompt_builder import PromptBuilder
from src.logger.logging import get_logger

logger = get_logger("api.services.attribute_extraction")


class AttributeExtractionService:
    """Service that extracts values from documents based on attribute definitions."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        workspace_names: List[str],
        vectorstore: str,
        top_k: int,
        file_names: Optional[List[str]] = None,
        sheet_name: Optional[str] = None,
        timeout: float = 120.0
    ):
        """
        Initialize the service.

        Args:
            api_key: LiteLLM API key
            base_url: LiteLLM base URL
            model: Model name to use
            workspace_names: List of workspace names to search
            vectorstore: Vectorstore name
            top_k: Number of search results to return
            file_names: Optional list of file names to filter search
            sheet_name: Optional sheet name to filter Excel document search
            timeout: Request timeout in seconds
        """
        # Ensure base_url ends with /v1
        if not base_url.endswith('/v1'):
            base_url = base_url.rstrip('/') + '/v1'

        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=httpx.Timeout(timeout, connect=30.0),
            max_retries=2
        )
        # Also create a sync client for sync operations
        self.sync_client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=httpx.Timeout(timeout, connect=30.0),
            max_retries=2
        )
        self.model = model
        self.file_names = file_names
        self.sheet_name = sheet_name

        # Build attribute mapping from file_names
        attribute_mapping = self._build_attribute_mapping(file_names) if file_names else {}

        # Initialize search toolkit
        self.search_toolkit = SearchToolkit(
            task_order=1,
            workspace_name=workspace_names,
            top_k=top_k,
            vectorstore=vectorstore,
            attribute_mapping=attribute_mapping,
            search_web="off"
        )

        self.messages = []
        self.search_queries = []

    async def search_documents(self, query: str) -> str:
        """
        Execute document search.

        Args:
            query: Search query

        Returns:
            Formatted search results as string
        """
        try:
            # Clear self.ids to prevent cross-contamination between searches
            self.search_toolkit.ids.clear()
            logger.info(f"[Async Search] Cleared toolkit IDs before search")

            if self.file_names or self.sheet_name:
                filters = {}
                if self.file_names:
                    filters["id"] = self.file_names
                if self.sheet_name:
                    filters["sheet_name"] = self.sheet_name

                results = await self.search_toolkit.perform_document_search(query, **filters)
            else:
                results = await self.search_toolkit.perform_standard_search(query)

            # Format results
            formatted_results = []

            # Add text results
            if results.get("sources_text"):
                formatted_results.append("=== Text Results ===")
                for idx, text_result in enumerate(results["sources_text"], 1):
                    content = text_result.get("page_content", "")
                    filename = text_result.get("filename", "Unknown")
                    formatted_results.append(f"\n[{idx}] From {filename}:\n{content}")

            # Add image results info
            if results.get("sources_image"):
                formatted_results.append(f"\n=== Found {len(results['sources_image'])} relevant images ===")
                if results.get("list_of_filenames"):
                    formatted_results.append(f"Image sources: {', '.join(results['list_of_filenames'])}")

            if not formatted_results:
                return "No results found for the query."

            return "\n".join(formatted_results)

        except Exception as e:
            logger.error(f"Search error: {e}")
            return f"Search error: {str(e)}"

    async def get_document_chunks(self, chunks: int = 1) -> str:
        """
        Execute document chunks retrieval for description generation.

        Args:
            chunks: Number of chunks to retrieve (default: 1)

        Returns:
            Formatted chunk results as string
        """
        try:
            # Clear self.ids to prevent cross-contamination between searches
            self.search_toolkit.ids.clear()

            # Create filter dictionary for SearchToolkit
            filters = {}
            if self.file_names:
                filters["id"] = self.file_names  # Use 'id' key to match what filter_ids expects
            if self.sheet_name:
                filters["sheet_name"] = self.sheet_name

            # Add chunks filter
            filters["chunks"] = chunks

            # Use SearchToolkit with empty query and chunks filter
            results = await self.search_toolkit.perform_document_search(
                query="",  # Empty query for document retrieval
                **filters
            )

            # Format results for description generation
            formatted_chunks = []
            if results.get("sources_text"):
                # Limit to the first N chunks
                limited_results = results["sources_text"][:chunks]
                for idx, chunk in enumerate(limited_results, 1):
                    content = chunk.get("page_content", "")
                    filename = chunk.get("filename", "Unknown")
                    formatted_chunks.append(f"Chunk {idx} from {filename}:\n{content}")

            result = "\n\n".join(formatted_chunks) if formatted_chunks else "No chunks found"
            logger.info(f"[get_document_chunks] Retrieved {len(formatted_chunks)} chunks for file_names {self.file_names}")
            return result

        except Exception as e:
            logger.error(f"Document chunks error: {e}")
            return f"Error retrieving document chunks: {str(e)}"

    def _generate_query_from_attributes(self, attributes: Dict[str, Any]) -> str:
        """
        Generate a user query from attribute definitions.

        Args:
            attributes: Dict mapping attribute names to AttributeDefinition objects

        Returns:
            Generated query string
        """
        # Build a natural language query from the attributes
        attr_list = []
        for attr_name, attr_def in attributes.items():
            description = attr_def.description if hasattr(attr_def, 'description') else attr_name
            attr_list.append(description)

        if len(attr_list) == 1:
            query = f"Extract the following information from the documents: {attr_list[0]}"
        else:
            query = f"Extract the following information from the documents: {', '.join(attr_list[:-1])}, and {attr_list[-1]}"

        return query

    async def execute(
        self,
        attributes: Dict[str, Any],
        max_iterations: int = 2
    ) -> str:
        """
        Execute attribute-based extraction.

        Args:
            attributes: Dict mapping attribute names to AttributeDefinition objects
            max_iterations: Maximum search iterations

        Returns:
            JSON string with extracted values

        Raises:
            HTTPException: If max iterations reached without completion
        """
        # Generate query from attributes
        user_message = self._generate_query_from_attributes(attributes)
        logger.info(f"Generated query: {user_message}")

        # Generate schema and prompt from attributes using utilities
        response_format = SchemaBuilder.build_from_attributes(attributes)

        # Check if description attribute is present and use appropriate prompt
        if SchemaBuilder.has_description_attribute(attributes):
            system_prompt = PromptBuilder.build_extraction_prompt_with_description(attributes)
        else:
            system_prompt = PromptBuilder.build_extraction_prompt(attributes)

        # Initialize conversation
        self.messages.append({
            "role": "system",
            "content": system_prompt
        })

        # Add user message
        self.messages.append({
            "role": "user",
            "content": user_message
        })

        # Get tool schemas
        tools = [
            SchemaBuilder.build_search_tool_schema(),
            SchemaBuilder.build_calculator_tool_schema()
        ]

        # Add document chunks tool if description attribute is present
        if SchemaBuilder.has_description_attribute(attributes):
            tools.append(SchemaBuilder.build_document_chunks_tool_schema())

        # Build initial request parameters
        request_params = {
            "model": self.model,
            "messages": self.messages,
            "tools": tools,
            "tool_choice": "auto"
        }

        # Agentic loop - allow multiple search attempts
        iteration = 0

        while iteration < max_iterations:
            iteration += 1

            response = await self.client.chat.completions.create(**request_params)
            response_message = response.choices[0].message

            # Handle tool calls
            if response_message.tool_calls:
                # Add assistant's response to messages
                self.messages.append(response_message)

                # Separate search and non-search tool calls for parallel execution
                search_tasks = []
                search_tool_calls = []
                other_tool_calls = []

                for tool_call in response_message.tool_calls:
                    function_name = tool_call.function.name

                    if function_name == "search_documents":
                        function_args = json.loads(tool_call.function.arguments)
                        query = function_args.get("query", "")

                        # Track search queries
                        self.search_queries.append(query)
                        logger.info(f"Executing search: {query}")

                        # Collect search task for parallel execution
                        search_tasks.append(self.search_documents(query))
                        search_tool_calls.append(tool_call)
                    else:
                        other_tool_calls.append(tool_call)

                # Execute all searches in parallel
                if search_tasks:
                    logger.info(f"Executing {len(search_tasks)} searches in parallel")
                    search_results_list = await asyncio.gather(*search_tasks)

                    # Add search results to messages
                    for tool_call, search_results in zip(search_tool_calls, search_results_list):
                        self.messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": "search_documents",
                            "content": search_results
                        })

                # Execute other tool calls (calculator, get_document_chunks, etc.) sequentially
                for tool_call in other_tool_calls:
                    function_name = tool_call.function.name

                    if function_name == "calculator":
                        function_args = json.loads(tool_call.function.arguments)
                        expression = function_args.get("expression", "")

                        logger.info(f"Executing calculator: {expression}")

                        # Execute calculation
                        calc_result =await calculator(expression)

                        # Add tool response to messages
                        self.messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": function_name,
                            "content": calc_result
                        })

                    elif function_name == "get_document_chunks":
                        function_args = json.loads(tool_call.function.arguments)
                        chunks = function_args.get("chunks", 1)

                        logger.info(f"Executing get_document_chunks: {chunks} chunks")

                        # Execute document chunks retrieval
                        chunks_result = await self.get_document_chunks(chunks)

                        # Add tool response to messages
                        self.messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": function_name,
                            "content": chunks_result
                        })

                # Update request params to continue the conversation
                request_params["messages"] = self.messages

            else:
                # No more tool calls, generate structured output
                structured_params = {
                    "model": self.model,
                    "messages": self.messages,
                    "response_format": response_format,
                }

                final_response = await self.client.chat.completions.create(**structured_params)
                final_message = final_response.choices[0].message

                logger.info(f"Extraction completed after {iteration} iterations, {len(self.search_queries)} searches")
                return final_message.content

        # Max iterations reached - try to generate output with context gathered so far
        logger.warning(f"Max iterations ({max_iterations}) reached. Attempting to generate output with {len(self.search_queries)} searches completed.")

        # Generate structured output with whatever context we have
        structured_params = {
            "model": self.model,
            "messages": self.messages,
            "response_format": response_format
        }

        final_response = await self.client.chat.completions.create(**structured_params)
        final_message = final_response.choices[0].message

        logger.info(f"Extraction completed after {max_iterations} iterations (max reached), {len(self.search_queries)} searches")
        return final_message.content

    def sync_execute(
        self,
        attributes: Dict[str, Any],
        max_iterations: int = 2
    ) -> str:
        """
        Execute attribute-based extraction (synchronous version).

        Args:
            attributes: Dict mapping attribute names to AttributeDefinition objects
            max_iterations: Maximum search iterations

        Returns:
            JSON string with extracted values

        Raises:
            HTTPException: If max iterations reached without completion
        """
        # Reset conversation state for each extraction
        self.messages = []
        self.search_queries = []

        # Log toolkit state before reset for debugging
        logger.info(f"[State Reset] Before reset - sources_text: {len(self.search_toolkit.sources_text)}, sources_image: {len(self.search_toolkit.sources_image)}, ids: {len(self.search_toolkit.ids)}")

        # Reset search toolkit state to prevent leakage between requests
        self.search_toolkit.reset_search_state()

        # Log toolkit state after reset to verify it's cleared
        logger.info(f"[State Reset] After reset - sources_text: {len(self.search_toolkit.sources_text)}, sources_image: {len(self.search_toolkit.sources_image)}, ids: {len(self.search_toolkit.ids)}")
        logger.info(f"[State Reset] Cleared search toolkit state for new extraction request")

        # Generate query from attributes
        user_message = self._generate_query_from_attributes(attributes)
        logger.info(f"Generated query: {user_message}")

        # Generate schema and prompt from attributes using utilities
        response_format = SchemaBuilder.build_from_attributes(attributes)

        # Check if description attribute is present and use appropriate prompt
        if SchemaBuilder.has_description_attribute(attributes):
            system_prompt = PromptBuilder.build_extraction_prompt_with_description(attributes)
        else:
            system_prompt = PromptBuilder.build_extraction_prompt(attributes)

        # Initialize conversation
        self.messages.append({
            "role": "system",
            "content": system_prompt
        })

        # Add user message
        self.messages.append({
            "role": "user",
            "content": user_message
        })

        # Get tool schemas
        tools = [
            SchemaBuilder.build_search_tool_schema(),
            SchemaBuilder.build_calculator_tool_schema()
        ]

        # Add document chunks tool if description attribute is present
        if SchemaBuilder.has_description_attribute(attributes):
            tools.append(SchemaBuilder.build_document_chunks_tool_schema())

        # Build initial request parameters
        request_params = {
            "model": self.model,
            "messages": self.messages,
            "tools": tools,
            "tool_choice": "auto"
        }

        # Agentic loop - allow multiple search attempts
        iteration = 0

        while iteration < max_iterations:
            iteration += 1

            response = self.sync_client.chat.completions.create(**request_params)
            response_message = response.choices[0].message

            # Handle tool calls
            if response_message.tool_calls:
                # Add assistant's response to messages
                self.messages.append(response_message)

                # Separate search and non-search tool calls for execution
                search_results_list = []
                search_tool_calls = []
                other_tool_calls = []

                for tool_call in response_message.tool_calls:
                    function_name = tool_call.function.name

                    if function_name == "search_documents":
                        function_args = json.loads(tool_call.function.arguments)
                        query = function_args.get("query", "")

                        # Track search queries
                        self.search_queries.append(query)
                        logger.info(f"Executing search: {query}")

                        # Execute search synchronously
                        search_result = self.sync_search_documents(query)
                        search_results_list.append(search_result)
                        search_tool_calls.append(tool_call)
                    else:
                        other_tool_calls.append(tool_call)

                # Add search results to messages
                for tool_call, search_result in zip(search_tool_calls, search_results_list):
                    self.messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": "search_documents",
                        "content": search_result
                    })

                # Execute other tool calls (calculator, get_document_chunks, etc.) sequentially
                for tool_call in other_tool_calls:
                    function_name = tool_call.function.name

                    if function_name == "calculator":
                        function_args = json.loads(tool_call.function.arguments)
                        expression = function_args.get("expression", "")

                        logger.info(f"Executing calculator: {expression}")

                        # Execute calculation synchronously
                        calc_result = self.sync_calculator(expression)

                        # Add tool response to messages
                        self.messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": function_name,
                            "content": calc_result
                        })

                    elif function_name == "get_document_chunks":
                        function_args = json.loads(tool_call.function.arguments)
                        chunks = function_args.get("chunks", 1)

                        logger.info(f"Executing get_document_chunks: {chunks} chunks")

                        # Execute document chunks retrieval synchronously
                        chunks_result = self.sync_get_document_chunks(chunks)

                        # Add tool response to messages
                        self.messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "name": function_name,
                            "content": chunks_result
                        })

                # Update request params to continue the conversation
                request_params["messages"] = self.messages

            else:
                # No more tool calls, generate structured output
                structured_params = {
                    "model": self.model,
                    "messages": self.messages,
                    "response_format": response_format,
                }

                final_response = self.sync_client.chat.completions.create(**structured_params)
                final_message = final_response.choices[0].message

                logger.info(f"Extraction completed after {iteration} iterations, {len(self.search_queries)} searches")
                return final_message.content

        # Max iterations reached - try to generate output with context gathered so far
        logger.warning(f"Max iterations ({max_iterations}) reached. Attempting to generate output with {len(self.search_queries)} searches completed.")

        # Generate structured output with whatever context we have
        structured_params = {
            "model": self.model,
            "messages": self.messages,
            "response_format": response_format
        }

        final_response = self.sync_client.chat.completions.create(**structured_params)
        final_message = final_response.choices[0].message

        logger.info(f"Extraction completed after {max_iterations} iterations (max reached), {len(self.search_queries)} searches")
        return final_message.content

    def sync_search_documents(self, query: str) -> str:
        """
        Execute document search (synchronous version).

        Args:
            query: Search query

        Returns:
            Formatted search results as string
        """
        try:
            logger.info(f"[Search] Query: '{query}', file_names: {self.file_names}, sheet_name: {self.sheet_name}")
            logger.info(f"[Search] Toolkit state before search - sources_text: {len(self.search_toolkit.sources_text)}, ids: {len(self.search_toolkit.ids)}")

            # Clear self.ids to prevent cross-contamination between searches
            self.search_toolkit.ids.clear()
            logger.info(f"[Search] Cleared toolkit IDs - now have {len(self.search_toolkit.ids)} IDs")

            if self.file_names or self.sheet_name:
                filters = {}
                if self.file_names:
                    filters["id"] = self.file_names
                if self.sheet_name:
                    filters["sheet_name"] = self.sheet_name
                logger.info(f"[Search] Using filtered search with filters: {filters}")

                # Run async search in sync context using asyncio
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    results = loop.run_until_complete(
                        self.search_toolkit.perform_document_search(query, **filters)
                    )
                finally:
                    loop.close()
            else:
                # Run async standard search in sync context
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    results = loop.run_until_complete(
                        self.search_toolkit.perform_standard_search(query)
                    )
                finally:
                    loop.close()

            # Log search results for debugging
            logger.info(f"[Search] Results sources_text: {len(results.get('sources_text', []))} items")
            if results.get("sources_text"):
                for i, source in enumerate(results["sources_text"][:2]):  # Log first 2 sources
                    logger.info(f"[Search] Source {i+1}: {source.get('metadata', {}).get('external_id', 'No ID')} - {source.get('filename', 'No filename')}")

            # Log toolkit state after search
            logger.info(f"[Search] Toolkit state after search - sources_text: {len(self.search_toolkit.sources_text)}, sources_image: {len(self.search_toolkit.sources_image)}, ids: {len(self.search_toolkit.ids)}")
            if self.search_toolkit.ids:
                logger.info(f"[Search] Current IDs in toolkit: {list(self.search_toolkit.ids)[:5]}...")  # Log first 5 IDs

            # Format results (same as async version)
            formatted_results = []

            # Add text results
            if results.get("sources_text"):
                formatted_results.append("=== Text Results ===")
                for idx, text_result in enumerate(results["sources_text"], 1):
                    content = text_result.get("page_content", "")
                    filename = text_result.get("filename", "Unknown")
                    formatted_results.append(f"\n[{idx}] From {filename}:\n{content}")

            # Add image results info
            if results.get("sources_image"):
                formatted_results.append(f"\n=== Found {len(results['sources_image'])} relevant images ===")
                if results.get("list_of_filenames"):
                    formatted_results.append(f"Image sources: {', '.join(results['list_of_filenames'])}")

            if not formatted_results:
                return "No results found for the query."

            return "\n".join(formatted_results)

        except Exception as e:
            logger.error(f"Search error: {e}")
            return f"Search error: {str(e)}"

    def sync_get_document_chunks(self, chunks: int = 1) -> str:
        """
        Execute document chunks retrieval for description generation (synchronous version).

        Args:
            chunks: Number of chunks to retrieve (default: 1)

        Returns:
            Formatted chunk results as string
        """
        try:
            # Clear any existing IDs from toolkit to prevent cross-contamination
            self.search_toolkit.ids.clear()
            logger.info(f"[Sync Chunks] Cleared toolkit IDs before chunk retrieval")

            # Create filter dictionary for SearchToolkit
            filters = {}
            if self.file_names:
                filters["id"] = self.file_names  # Use 'id' key to match what filter_ids expects
            if self.sheet_name:
                filters["sheet_name"] = self.sheet_name

            # Add chunks filter
            filters["chunks"] = chunks

            # Run async search in sync context
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                results = loop.run_until_complete(
                    self.search_toolkit.perform_document_search(
                        query="",  # Empty query for document retrieval
                        **filters
                    )
                )
            finally:
                loop.close()

            # Format results for description generation (same as async version)
            formatted_chunks = []
            if results.get("sources_text"):
                # Limit to the first N chunks
                limited_results = results["sources_text"][:chunks]
                for idx, chunk in enumerate(limited_results, 1):
                    content = chunk.get("page_content", "")
                    filename = chunk.get("filename", "Unknown")
                    formatted_chunks.append(f"Chunk {idx} from {filename}:\n{content}")

            result = "\n\n".join(formatted_chunks) if formatted_chunks else "No chunks found"
            logger.info(f"[sync_get_document_chunks] Retrieved {len(formatted_chunks)} chunks for file_names {self.file_names}")
            return result

        except Exception as e:
            logger.error(f"Document chunks error: {e}")
            return f"Error retrieving document chunks: {str(e)}"

    def sync_calculator(self, expression: str) -> str:
        """
        Execute calculation (synchronous version).

        Args:
            expression: Mathematical expression to evaluate

        Returns:
            Calculation result as string
        """
        try:
            # Run async calculator in sync context
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result = loop.run_until_complete(calculator(expression))
            finally:
                loop.close()
            return result
        except Exception as e:
            logger.error(f"Calculator error: {e}")
            return f"Calculation error: {str(e)}"

    def _build_attribute_mapping(self, file_names: List[str]) -> Dict[str, Any]:
        """
        Build attribute mapping from file names for document filtering.

        Args:
            file_names: List of file names

        Returns:
            Attribute mapping dictionary with file name to internal UUID mapping
        """

        attribute_mapping = {
            "id": {}
        }

        for file_name in file_names:
            attribute_mapping["id"][file_name] = [file_name]
            logger.info(f"[Attribute Mapping] Mapped file_name '{file_name}' to internal UUID '{file_name}'")

        logger.info(f"[Attribute Mapping] Built mapping for {len(file_names)} documents")
        return attribute_mapping

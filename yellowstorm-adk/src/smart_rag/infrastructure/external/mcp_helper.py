"""
MCP Helper Module

Handles MCP (Model Context Protocol) operations including Excel MCP headers and file uploads.
"""

import json
import base64
import asyncio
import aiohttp
from typing import Optional, Dict, List
from mcp import ClientSession
from mcp.client.sse import sse_client
from src.config.settings import get_settings
from src.logger.logging import get_logger
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import SseServerParams
from google.adk.tools.mcp_tool.mcp_toolset import StreamableHTTPConnectionParams
logger = get_logger("api.smart_rag.mcp_helper")
app_settings = get_settings()


class MCPHelper:
    """Handles MCP-related operations."""

    @staticmethod
    def create_excel_mcp_headers(user_id: str, brain_ids: List[str],
                                 session_id: str, brain_documents: List) -> Optional[Dict]:
        """Create Excel MCP headers.

        Args:
            user_id (str): The user ID.
            brain_ids (List[str]): List of brain IDs.
            session_id (str): The session/message ID.
            brain_documents (List): List of brain documents to encode.
        Returns:
            Optional[Dict]: Dictionary of MCP headers or None on failure.

        """
        try:
            minimal_brain_docs = MCPHelper.extract_minimal_fields(brain_documents)
            brain_docs_str = json.dumps(minimal_brain_docs)
            encoded_brain_docs = base64.b64encode(brain_docs_str.encode('utf-8')).decode('utf-8')

            headers = {
                "X-User-ID": user_id,
                "X-Brain-ID": brain_ids[0],  # Assuming brain_ids is a list of one item
                "X-Message-ID": session_id,
                "X-Brain-Documents": encoded_brain_docs
            }
            logger.debug(f"Successfully created MCP headers with brain ID: {brain_ids[0]}")
            return headers
        except (IndexError, TypeError, json.JSONDecodeError) as e:
            logger.error(f"Error creating Excel MCP headers for user {user_id}: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error creating Excel MCP headers for user {user_id}: {str(e)}")
            return None

    @staticmethod
    async def upload_files_to_datalake(user_id: str, brain_id: str, message_id: str) -> Dict:
        """Upload files to datalake using the Excel MCP server.

        Args:
            user_id (str): The user ID.
            brain_id (str): The brain ID.
            message_id (str): The message/session ID.

        Returns:
            Dict: Result of the upload operation or error details.
        """
        sse_gen = None
        try:
            # Create the SSE client generator
            sse_gen = sse_client(app_settings.EXCEL_MCP_URL)

            # Use proper nested async context managers for automatic cleanup
            async with sse_gen as streams:
                logger.debug("SSE client connection established")
                async with ClientSession(streams[0], streams[1]) as session:
                    # Initialize the MCP session
                    await session.initialize()
                    logger.debug("MCP session initialized")

                    # Call the upload_files tool
                    result = await session.call_tool(
                        "upload_files",
                        arguments={
                            "user_id": user_id,
                            "brain_id": brain_id,
                            "message_id": message_id
                        }
                    )

                    if result.isError:
                        error_msg = f"Tool error: {result.content[0].text}"
                        logger.error(error_msg)
                        raise Exception(error_msg)

                    # Parse the result
                    response_text = result.content[0].text
                    logger.debug(f"Received response from upload tool: {response_text[:100]}...")
                    try:
                        response_data = json.loads(response_text)
                        return response_data
                    except json.JSONDecodeError as e:
                        logger.error(f"Error parsing response JSON: {str(e)}")
                        return {"error": "Failed to parse response", "raw_response": response_text}

        except Exception as e:
            logger.error(f"Error during MCP upload call for user {user_id}: {str(e)}")
            return {"error": str(e)}

    @staticmethod
    def create_mcp_toolset(connection_params, mcp_type: str = 'unknown'):
        """Create MCP toolset from connection parameters.

        Args:
            connection_params: MCP connection parameters.
            mcp_type (str): Type/name of the MCP for identification.
        Returns:
            MCPToolset: The MCP toolset instance with mcp_type attribute.
        """
        try:
            toolset = MCPToolset(connection_params=connection_params)
            # Add a custom attribute to identify the MCP type
            toolset.mcp_type = mcp_type
            return toolset
        except Exception as e:
            logger.error(f"Error creating MCP toolset: {str(e)}")
            raise

    @staticmethod
    def create_mcp_context_headers(
        user_id: str,
        file_names: Optional[List[str]] = None,
        workspace_names: Optional[List[str]] = None,
    ) -> Optional[Dict]:
        """Create MCP context headers (user_id, file_name, workspace_name)."""
        try:
            headers: Dict[str, str] = {"user_id": user_id}

            if file_names:
                headers["file_name"] = json.dumps(file_names) if len(file_names) > 1 else file_names[0]

            if workspace_names:
                headers["workspace_name"] = json.dumps(workspace_names) if len(workspace_names) > 1 else workspace_names[0]

            logger.debug(f"MCP context headers: {headers}")
            return headers
        except Exception as e:
            logger.error(f"Error creating MCP context headers for user {user_id}: {str(e)}")
            return None

    @staticmethod
    def create_mcp_config(mcp_type: str, **kwargs):
        """Create MCP configuration for different MCP types.

        Args:
            mcp_type (str): Type of MCP ('excel', 'microsandbox', etc.)
            **kwargs: Additional configuration parameters
        Returns:
            Connection parameters for the specified MCP type
        """
        try:
            transport_type = kwargs.get('transport_type')

            # streamable_http: always inject user context headers
            if transport_type == 'streamable_http' and mcp_type not in ['microsandbox']:
                url = kwargs.get('url')
                if not url:
                    raise ValueError(f"'url' is required for transport_type=streamable_http (mcp_type={mcp_type})")
                user_id = kwargs.get('user_id')
                headers = {}
                if user_id:
                    headers = MCPHelper.create_mcp_context_headers(
                        user_id=user_id,
                        file_names=kwargs.get('file_names'),
                        workspace_names=kwargs.get('workspace_names'),
                    ) or {}
                return StreamableHTTPConnectionParams(url=url, headers=headers)

            elif mcp_type == 'excel':
                headers = kwargs.get('headers', {})
                return SseServerParams(
                    url=app_settings.EXCEL_MCP_URL,
                    headers=headers
                )

            elif mcp_type == 'microsandbox':
                url = kwargs.get('url', app_settings.MICROSANDBOX_MCP_URL)
                if not url:
                    raise ValueError("MICROSANDBOX_MCP_URL is not configured")
                return StreamableHTTPConnectionParams(url=url)

            elif mcp_type == 'snowflake':
                url = kwargs.get('url', app_settings.SNOWFLAKE_MCP_URL)
                if not url:
                    raise ValueError("SNOWFLAKE_MCP_URL is not configured")
                return SseServerParams(url=url, timeout=180.0)

            elif mcp_type == 'dataviz':
                url = kwargs.get('url', app_settings.DATAVIZ_MCP_URL)
                if not url:
                    raise ValueError("DATAVIZ_MCP_URL is not configured")
                return SseServerParams(url=url, timeout=180.0)

            elif mcp_type == 'github':
                url = kwargs.get('url')
                if not url:
                    raise ValueError("URL is required for github MCP type")
                return StreamableHTTPConnectionParams(url=url)

            else:
                raise ValueError(f"Unsupported MCP type: {mcp_type}")

        except Exception as e:
            logger.error(f"Error creating {mcp_type} MCP config: {str(e)}")
            raise

    @staticmethod
    def create_toolsets(mcp_configs: List[Dict]):
        """Create multiple MCP toolsets from configurations.

        Args:
            mcp_configs (List[Dict]): List of MCP configurations
                Each config should have 'type' and optional parameters
        Returns:
            List[MCPToolset]: List of created toolsets
        """
        toolsets = []

        for config in mcp_configs:
            mcp_type = config.get('type')
            try:
                if not mcp_type:
                    logger.warning(f"MCP config missing 'type' field: {config}")
                    continue

                # Skip Excel MCP if no headers provided
                if mcp_type == 'excel' and not config.get('headers'):
                    continue

                connection_params = MCPHelper.create_mcp_config(mcp_type, **config)
                toolset = MCPHelper.create_mcp_toolset(connection_params, mcp_type)
                toolsets.append(toolset)

            except ValueError as e:
                logger.error(f"Configuration error for {mcp_type} toolset: {str(e)}")
                continue
            except Exception as e:
                logger.error(f"Failed to create {mcp_type} toolset: {str(e)}", exc_info=True)
                continue

        return toolsets

    @staticmethod
    def get_mcp_type_from_toolset(toolset):
        """Get MCP type from a toolset instance.

        Args:
            toolset: MCP toolset instance
        Returns:
            str: MCP type/name or 'unknown' if not identified
        """
        try:
            # Check if toolset has our custom mcp_type attribute
            if hasattr(toolset, 'mcp_type'):
                return toolset.mcp_type
        except Exception as e:
            logger.debug(f"Error identifying MCP type from toolset: {e}")

        return 'unknown'

    @staticmethod
    async def identify_mcp_for_function(agent, function_name):
        """Identify MCP type for a function name.

        Hardcoded mapping for microsandbox tools only.
        """
        if not hasattr(agent, 'tools'):
            return None

        # Hardcoded list of microsandbox tools
        MICROSANDBOX_TOOLS = [
            'sandbox_start',
            'sandbox_stop',
            'sandbox_run_code',
            'sandbox_run_command',
            'sandbox_get_metrics'
        ]

        # Check if function is a microsandbox tool
        if function_name in MICROSANDBOX_TOOLS:
            # Verify microsandbox toolset exists on agent
            for tool in agent.tools:
                if isinstance(tool, MCPToolset):
                    mcp_type = MCPHelper.get_mcp_type_from_toolset(tool)
                    if mcp_type == 'microsandbox':
                        logger.debug(f"Identified {function_name} as microsandbox tool")
                        return 'microsandbox'

        # Not a microsandbox tool or microsandbox not available
        return None

    @staticmethod
    async def get_microsandbox_uploaded_files(brain_id: str, session_id: str) -> List[Dict]:
        """Get uploaded files from microsandbox document server.

        Args:
            brain_id (str): The brain ID
            session_id (str): The session ID

        Returns:
            List[Dict]: List of uploaded files with azure_path and filename
        """
        try:
            # Get microsandbox document server URL
            document_server_url = app_settings.MICROSANDBOX_DOCUMENT_SERVER_URL
            if not document_server_url:
                logger.warning("MICROSANDBOX_DOCUMENT_SERVER_URL not configured, skipping uploaded files retrieval")
                return []

            # Call the uploads endpoint
            endpoint_url = f"{document_server_url}/uploads/{session_id}"

            async with aiohttp.ClientSession() as session:
                async with session.get(endpoint_url) as response:
                    if response.status == 200:
                        data = await response.json()
                        uploaded_files = data.get('uploaded_files', [])
                        return uploaded_files
                    else:
                        logger.warning(f"Failed to get uploads from microsandbox server: {response.status}")
                        return []

        except Exception as e:
            logger.error(f"Error getting microsandbox uploaded files: {str(e)}")
            return []

    @staticmethod
    def extract_minimal_fields(data):
        """Extract only filepath, filename, and _id from a list of JSON objects.
        Removes duplicates based on _id.

        Args:
            data (list): List of dictionaries containing file metadata

        Returns:
            list: List of dictionaries with only the required fields, deduplicated
        """
        result = []
        seen_combinations = set()

        for item in data:
            minimal_item = {}

            # Add filepath and filename if they exist
            for field in ['filepath', 'filename']:
                if field in item:
                    minimal_item[field] = item[field]

            # Add _id if it exists
            if '_id' in item:
                minimal_item['_id'] = item['_id']

            # Create a unique key for deduplication based only on _id
            doc_id = minimal_item.get('_id')

            # Only add if this _id hasn't been seen before and has filepath
            if doc_id not in seen_combinations and 'filepath' in minimal_item:
                seen_combinations.add(doc_id)
                result.append(minimal_item)

        return result
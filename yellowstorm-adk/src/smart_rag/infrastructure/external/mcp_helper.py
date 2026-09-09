"""
MCP Helper Module

Handles MCP (Model Context Protocol) operations.
"""

import json
import aiohttp
from typing import Any, Optional, Dict, List
from src.config.settings import get_settings
from src.logger.logging import get_logger
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_toolset import StreamableHTTPConnectionParams
from src.smart_rag.infrastructure.external.purpose_aware_mcp import PurposeAwareMcpToolset
logger = get_logger("api.smart_rag.mcp_helper")
app_settings = get_settings()


class MCPHelper:
    """Handles MCP-related operations."""

    @staticmethod
    def extract_requested_mcp_types(
        tools: Optional[List[Any]] = None,
        agent_params: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        requested_types: List[str] = []

        def add_type(raw_value: Any) -> None:
            if not isinstance(raw_value, str):
                return
            for item in raw_value.split(','):
                normalized = item.strip().lower()
                if normalized and normalized not in requested_types:
                    requested_types.append(normalized)

        if isinstance(agent_params, dict):
            add_type(agent_params.get("mcp_type"))
            add_type(agent_params.get("mcp_types"))

        for tool in tools or []:
            if isinstance(tool, dict):
                add_type(tool.get("mcp_type"))

        return requested_types

    @staticmethod
    def has_requested_mcp_type(
        mcp_type: str,
        tools: Optional[List[Any]] = None,
        agent_params: Optional[Dict[str, Any]] = None,
    ) -> bool:
        normalized_target = mcp_type.strip().lower()
        if not normalized_target:
            return False
        return normalized_target in MCPHelper.extract_requested_mcp_types(tools, agent_params)

    @staticmethod
    def create_mcp_toolset(connection_params, mcp_type: str = 'unknown', tool_filter: Optional[List[str]] = None):
        """Create MCP toolset from connection parameters.

        Args:
            connection_params: MCP connection parameters.
            mcp_type (str): Type/name of the MCP for identification.
            tool_filter (Optional[List[str]]): Optional whitelist of tool names to load.
        Returns:
            MCPToolset: The MCP toolset instance with mcp_type attribute.
        """
        try:
            kwargs = {"connection_params": connection_params}
            if tool_filter is not None:
                kwargs["tool_filter"] = tool_filter
            toolset = PurposeAwareMcpToolset(**kwargs)
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
        workspace_ids: Optional[List[str]] = None,
    ) -> Optional[Dict]:
        """Create MCP context headers (user_id, file_name, workspace_id)."""
        try:
            headers: Dict[str, str] = {"user_id": user_id}
            effective_workspace_ids = workspace_ids or workspace_names

            if file_names:
                headers["file_name"] = json.dumps(file_names) if len(file_names) > 1 else file_names[0]

            if effective_workspace_ids:
                headers["workspace_id"] = (
                    json.dumps(effective_workspace_ids)
                    if len(effective_workspace_ids) > 1
                    else effective_workspace_ids[0]
                )
                headers["Workspace-Id"] = ",".join(effective_workspace_ids)

            logger.debug(f"MCP context headers: {headers}")
            return headers
        except Exception as e:
            logger.error(f"Error creating MCP context headers for user {user_id}: {str(e)}")
            return None

    @staticmethod
    def create_mcp_config(mcp_type: str, **kwargs):
        """Create MCP configuration for different MCP types.

        Args:
            mcp_type (str): Type of MCP ('vectorstore', 'microsandbox', etc.)
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
                        workspace_ids=kwargs.get('workspace_ids'),
                        workspace_names=kwargs.get('workspace_names'),
                    ) or {}
                headers.update(kwargs.get('auth_headers') or {})
                return StreamableHTTPConnectionParams(url=url, headers=headers)

            elif mcp_type == 'microsandbox':
                url = kwargs.get('url', app_settings.MICROSANDBOX_MCP_URL)
                if not url:
                    raise ValueError("MICROSANDBOX_MCP_URL is not configured")
                return StreamableHTTPConnectionParams(url=url)

            elif mcp_type == 'github':
                url = kwargs.get('url')
                if not url:
                    raise ValueError("URL is required for github MCP type")
                return StreamableHTTPConnectionParams(url=url)

            elif mcp_type == 'vectorstore':
                url = kwargs.get('url', app_settings.VECTORSTORE_MCP_URL)
                if not url:
                    raise ValueError("VECTORSTORE_MCP_URL is not configured")
                headers = kwargs.get('headers', {})
                return StreamableHTTPConnectionParams(
                    url=url,
                    headers=headers,
                    timeout=180.0,
                )

            elif mcp_type == 'community_graph':
                url = kwargs.get('url') or getattr(app_settings, "COMMUNITY_GRAPH_MCP_URL", None)
                if not url:
                    raise ValueError("COMMUNITY_GRAPH_MCP_URL is not configured")
                return StreamableHTTPConnectionParams(
                    url=url,
                    timeout=180.0,
                )

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

                connection_params = MCPHelper.create_mcp_config(mcp_type, **config)
                tf = config.get('tool_filter')
                toolset = MCPHelper.create_mcp_toolset(connection_params, mcp_type, tool_filter=tf)
                toolsets.append(toolset)

            except ValueError as e:
                logger.error(f"Configuration error for {mcp_type} toolset: {str(e)}")
                continue
            except Exception as e:
                logger.error(f"Failed to create {mcp_type} toolset: {str(e)}", exc_info=True)
                continue

        return toolsets

    @staticmethod
    def create_vectorstore_toolsets_with_deep_search(
        brain_ids: Optional[List[str]] = None,
        deep_search: bool = False,
        required: bool = True,
    ):
        if not app_settings.VECTORSTORE_MCP_URL:
            raise ValueError("VECTORSTORE_MCP_URL is not configured")

        headers = {}
        if brain_ids:
            headers["X-Brain-ID"] = ",".join(brain_ids)
        if deep_search:
            headers["X-Deep-Search"] = "true"

        logger.info(
            "Attaching vectorstore MCP toolset at %s (deep_search=%s)",
            app_settings.VECTORSTORE_MCP_URL,
            deep_search,
        )

        configs = [{'type': 'vectorstore', 'headers': headers}]

        toolsets = []
        for config in configs:
            mcp_type = config.get('type')
            try:
                if not mcp_type:
                    continue
                connection_params = MCPHelper.create_mcp_config(mcp_type, **config)
                toolset = MCPHelper.create_mcp_toolset(connection_params, mcp_type)
                toolsets.append(toolset)
            except Exception as e:
                logger.error(f"Failed to create {mcp_type} toolset: {str(e)}", exc_info=True)
                if required:
                    raise
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

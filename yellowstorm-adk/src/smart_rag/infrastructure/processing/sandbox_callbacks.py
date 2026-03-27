"""
Sandbox Callbacks Module

Handles callback functions for sandbox lifecycle management including file downloading,
mounting, and cleanup operations.
"""

import json
import base64
import requests
import subprocess
from typing import Optional, Dict, Any
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset

logger = get_logger("api.smart_rag.sandbox_callbacks")
settings = get_settings()


class SandboxCallbackManager:
    """Manages callback functions for sandbox operations."""

    def __init__(self, session_id: str, brain_documents: list, conversation_brain_id: str = None):
        self.session_id = session_id
        self.brain_documents = brain_documents
        self.conversation_brain_id = conversation_brain_id

        self.encoded_brain_docs = self._encode_brain_documents()

    def _is_microsandbox_tool(self, tool) -> bool:
        """Check if tool belongs to microsandbox MCP."""
        try:
            # Check if this is an MCP toolset with session manager
            if hasattr(tool, '_mcp_session_manager') and hasattr(tool._mcp_session_manager, '_connection_params'):
                connection_params = tool._mcp_session_manager._connection_params

                # Check if it has a URL and compare to environment variable
                if hasattr(connection_params, 'url') and connection_params.url:
                    url = connection_params.url
                    # Compare with Microsandbox MCP URL from environment
                    if hasattr(settings, 'MICROSANDBOX_MCP_URL') and url == settings.MICROSANDBOX_MCP_URL:
                        return True

            return False
        except Exception as e:
            logger.exception(f"Error checking if tool is microsandbox: {e}")
            return False

    def _encode_brain_documents(self) -> str:
        """Encode brain documents for transmission."""
        try:
            minimal_brain_docs = MCPHelper.extract_minimal_fields(self.brain_documents)
            brain_docs_str = json.dumps(minimal_brain_docs)
            return base64.b64encode(brain_docs_str.encode('utf-8')).decode('utf-8')
        except Exception as e:
            logger.exception(f"Error encoding brain documents: {str(e)}")
            return ""

    def create_before_tool_callback(self):
        """Create before tool callback function."""
        def before_tool_callback(tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext) -> Optional[Dict]:
            if not hasattr(tool, 'name'):
                return None

            # Check if this is a microsandbox tool
            if not self._is_microsandbox_tool(tool):
                return None

            # Set namespace and sandbox to session_id for all microsandbox tools
            args['namespace'] = self.session_id
            args['sandbox'] = self.session_id

            if tool.name == "sandbox_start":
                self._handle_sandbox_start(args)
            return None

        return before_tool_callback

    def create_after_tool_callback(self):
        """Create after tool callback function."""
        def after_tool_callback(tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext, tool_response: Dict) -> Optional[Dict]:

            # Only handle sandbox_stop from microsandbox tools
            if not self._is_microsandbox_tool(tool) or tool.name != "sandbox_stop":
                return None

            self._handle_sandbox_stop()
            return None

        return after_tool_callback

    def _handle_sandbox_start(self, args: Dict[str, Any]):
        """Handle sandbox start operations."""
        try:
            # Ensure config exists
            if 'config' not in args:
                args['config'] = {}

            # Replace Python images with custom image
            current_image = args['config'].get('image', '')
            if 'python' in current_image.lower() and settings.MICROSANDBOX_DOCKER_IMAGE:
                args['config']['image'] = settings.MICROSANDBOX_DOCKER_IMAGE

            # Remove any existing volumes from config
            if 'volumes' in args['config']:
                del args['config']['volumes']

            # Download files and add volume mounts
            self._download_and_mount_files(args)

        except Exception as e:
            logger.exception(f"Error in sandbox start callback: {str(e)}")

    def _download_and_mount_files(self, args: Dict[str, Any]):
        """Download files and add volume mounts to sandbox config."""

        if not self.encoded_brain_docs:
            return

        if not settings.MICROSANDBOX_DOCUMENT_SERVER_URL:
            logger.warning("MICROSANDBOX_DOCUMENT_SERVER_URL not configured, skipping file download")
            return

        try:
            download_url = f"{settings.MICROSANDBOX_DOCUMENT_SERVER_URL}/download"
            params = {
                'brain_docs': self.encoded_brain_docs,
                'session_id': self.session_id,
                'brain_id': self.conversation_brain_id
            }

            response = requests.get(download_url, params=params, timeout=30)  # Add timeout

            if response.status_code == 200:
                result = response.json()
                download_path = result.get('download_path')

                if download_path:

                    if 'volumes' not in args['config']:
                        args['config']['volumes'] = []

                    volume_mount = f"{download_path}:/mnt/downloaded_files"
                    args['config']['volumes'].append(volume_mount)
                else:
                    logger.warning("No download path in response")
            else:
                logger.error(f"Download failed with status {response.status_code}: {response.text}")

        except requests.exceptions.Timeout:
            logger.exception(f"Timeout downloading files from document server")
        except Exception as e:
            logger.exception(f"Error downloading and mounting files: {str(e)}")



    def _handle_sandbox_stop(self):
        """Handle sandbox stop cleanup operations."""
        try:
            self._stop_file_watcher()
        except Exception as e:
            logger.exception(f"Error in sandbox stop callback: {str(e)}")

    def _stop_file_watcher(self):
        """Stop file watcher for the session."""
        if not settings.MICROSANDBOX_DOCUMENT_SERVER_URL:
            logger.warning("MICROSANDBOX_DOCUMENT_SERVER_URL not configured, skipping watcher stop")
            return

        try:
            requests.post(f"{settings.MICROSANDBOX_DOCUMENT_SERVER_URL}/watcher/{self.session_id}/stop")
        except Exception as e:
            logger.exception(f"Error stopping file watcher: {str(e)}")


def create_sandbox_callbacks(session_id: str, brain_documents: list, conversation_brain_id: str = None):
    """Create sandbox callback functions.

    Args:
        session_id (str): Session identifier
        brain_documents (list): List of brain documents
        conversation_brain_id (str): Conversation brain ID from brain_ids list

    Returns:
        tuple: (before_callback, after_callback)

    Raises:
        ValueError: If microsandbox environment variables are not configured
    """
    # Verify that microsandbox is configured before creating callbacks
    if not settings.MICROSANDBOX_MCP_URL:
        raise ValueError("Cannot create sandbox callbacks: MICROSANDBOX_MCP_URL is not configured")

    callback_manager = SandboxCallbackManager(session_id, brain_documents, conversation_brain_id)
    return (
        callback_manager.create_before_tool_callback(),
        callback_manager.create_after_tool_callback()
    )
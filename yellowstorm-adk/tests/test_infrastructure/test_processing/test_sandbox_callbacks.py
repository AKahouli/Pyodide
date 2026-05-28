"""Tests for Sandbox Callbacks."""

import pytest
import json
import base64
from unittest.mock import MagicMock, patch, Mock
import requests

from src.smart_rag.infrastructure.processing.sandbox_callbacks import (
    SandboxCallbackManager,
    create_sandbox_callbacks
)


class TestSandboxCallbackManager:
    """Test cases for SandboxCallbackManager."""

    def create_mock_brain_documents(self):
        """Create mock brain documents for testing."""
        return [
            {"brainId": "brain123", "filename": "test1.txt", "_id": "doc1"},
            {"brainId": "brain456", "filename": "test2.pdf", "_id": "doc2"}
        ]

    def create_mock_tool(self, name: str = "test_tool", is_microsandbox: bool = False):
        """Create a mock tool for testing."""
        mock_tool = Mock()
        mock_tool.name = name

        if is_microsandbox:
            # Mock microsandbox tool structure
            mock_tool._mcp_session_manager = Mock()
            mock_tool._mcp_session_manager._connection_params = Mock()
            mock_tool._mcp_session_manager._connection_params.url = "https://test-microsandbox-url"

        return mock_tool

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_init(self, mock_get_settings):
        """Test SandboxCallbackManager initialization."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        session_id = "session123"
        brain_docs = self.create_mock_brain_documents()

        with patch.object(SandboxCallbackManager, '_encode_brain_documents', return_value='encoded_docs'):
            manager = SandboxCallbackManager(session_id, brain_docs)

            assert manager.session_id == session_id
            assert manager.brain_documents == brain_docs
            assert manager.encoded_brain_docs == 'encoded_docs'

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    def test_is_microsandbox_tool_true(self, mock_settings):
        """Test _is_microsandbox_tool returns True for microsandbox tools."""
        mock_settings.MICROSANDBOX_MCP_URL = "https://test-microsandbox-url"

        manager = SandboxCallbackManager("session123", [])
        mock_tool = self.create_mock_tool(is_microsandbox=True)

        result = manager._is_microsandbox_tool(mock_tool)
        assert result is True

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    def test_is_microsandbox_tool_false(self, mock_settings):
        """Test _is_microsandbox_tool returns False for non-microsandbox tools."""
        mock_settings.MICROSANDBOX_MCP_URL = "https://different-url"

        manager = SandboxCallbackManager("session123", [])
        mock_tool = self.create_mock_tool(is_microsandbox=False)

        result = manager._is_microsandbox_tool(mock_tool)
        assert result is False

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_is_microsandbox_tool_exception(self, mock_get_settings):
        """Test _is_microsandbox_tool handles exceptions gracefully."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])

        # Tool without required attributes
        mock_tool = Mock()
        del mock_tool._mcp_session_manager  # This will cause AttributeError

        result = manager._is_microsandbox_tool(mock_tool)
        assert result is False

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.MCPHelper.extract_minimal_fields')
    def test_encode_brain_documents_success(self, mock_extract_minimal):
        """Test _encode_brain_documents successful encoding."""
        mock_extract_minimal.return_value = [{"field": "value"}]

        manager = SandboxCallbackManager("session123", [{"field": "value", "extra": "ignored"}])

        result = manager._encode_brain_documents()

        # Verify the result is base64 encoded JSON
        assert result is not None
        decoded = base64.b64decode(result).decode('utf-8')
        assert json.loads(decoded) == [{"field": "value"}]

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.MCPHelper.extract_minimal_fields')
    def test_encode_brain_documents_exception(self, mock_extract_minimal):
        """Test _encode_brain_documents handles exceptions."""
        mock_extract_minimal.side_effect = Exception("Encoding error")

        manager = SandboxCallbackManager("session123", [])

        result = manager._encode_brain_documents()
        assert result == ""

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_create_before_tool_callback(self, mock_get_settings):
        """Test create_before_tool_callback creates functional callback."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])
        callback = manager.create_before_tool_callback()

        assert callable(callback)

        # Test with non-microsandbox tool
        mock_tool = Mock()
        mock_tool.name = "other_tool"
        args = {}
        mock_context = Mock()

        with patch.object(manager, '_is_microsandbox_tool', return_value=False):
            result = callback(mock_tool, args, mock_context)
            assert result is None

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_before_tool_callback_microsandbox_tool(self, mock_get_settings):
        """Test before tool callback with microsandbox tool."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])
        callback = manager.create_before_tool_callback()

        mock_tool = Mock()
        mock_tool.name = "sandbox_start"
        args = {}
        mock_context = Mock()

        with patch.object(manager, '_is_microsandbox_tool', return_value=True), \
             patch.object(manager, '_handle_sandbox_start') as mock_handle:

            result = callback(mock_tool, args, mock_context)

            # Should set namespace and sandbox to session_id
            assert args['namespace'] == "session123"
            assert args['sandbox'] == "session123"
            mock_handle.assert_called_once_with(args)
            assert result is None

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_create_after_tool_callback(self, mock_get_settings):
        """Test create_after_tool_callback creates functional callback."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])
        callback = manager.create_after_tool_callback()

        assert callable(callback)

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_after_tool_callback_sandbox_stop(self, mock_get_settings):
        """Test after tool callback with sandbox_stop."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])
        callback = manager.create_after_tool_callback()

        mock_tool = Mock()
        mock_tool.name = "sandbox_stop"
        args = {}
        mock_context = Mock()
        mock_response = {}

        with patch.object(manager, '_is_microsandbox_tool', return_value=True), \
             patch.object(manager, '_handle_sandbox_stop') as mock_handle:

            result = callback(mock_tool, args, mock_context, mock_response)

            mock_handle.assert_called_once()
            assert result is None

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    def test_handle_sandbox_start_python_image_replacement(self, mock_settings):
        """Test _handle_sandbox_start replaces Python image."""
        mock_settings.MICROSANDBOX_DOCKER_IMAGE = "custom/python:latest"

        manager = SandboxCallbackManager("session123", [])
        args = {
            'config': {
                'image': 'python:3.9',
                'volumes': ['old_volume']
            }
        }

        with patch.object(manager, '_download_and_mount_files') as mock_download:
            manager._handle_sandbox_start(args)

            assert args['config']['image'] == "custom/python:latest"
            assert 'volumes' not in args['config']  # Should be removed
            mock_download.assert_called_once_with(args)

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_handle_sandbox_start_no_config(self, mock_get_settings):
        """Test _handle_sandbox_start creates config if not present."""
        mock_settings = Mock()
        mock_settings.MICROSANDBOX_DOCKER_IMAGE = "custom/python:latest"
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])
        args = {}

        with patch.object(manager, '_download_and_mount_files') as mock_download:
            manager._handle_sandbox_start(args)

            assert 'config' in args
            assert isinstance(args['config'], dict)
            mock_download.assert_called_once_with(args)

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.requests.get')
    def test_download_and_mount_files_success(self, mock_get, mock_settings):
        """Test _download_and_mount_files successful operation."""
        mock_settings.MICROSANDBOX_DOCUMENT_SERVER_URL = "https://test-server"

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"download_path": "/path/to/files"}
        mock_get.return_value = mock_response

        manager = SandboxCallbackManager("session123", [], "brain_123")
        manager.encoded_brain_docs = "encoded_docs"

        args = {'config': {}}
        manager._download_and_mount_files(args)

        # Verify volume mount was added
        assert 'volumes' in args['config']
        assert "/path/to/files:/mnt/downloaded_files" in args['config']['volumes']

        # Verify API call
        mock_get.assert_called_once_with(
            "https://test-server/download",
            params={
                'brain_docs': 'encoded_docs',
                'session_id': 'session123',
                'workspace_name': 'brain_123'
            },
            timeout=30
        )

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.requests.get')
    def test_download_and_mount_files_no_docs(self, mock_get, mock_get_settings):
        """Test _download_and_mount_files with no encoded docs."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])
        manager.encoded_brain_docs = ""  # Empty

        args = {'config': {}}
        manager._download_and_mount_files(args)

        # Should not make API call
        mock_get.assert_not_called()

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.requests.get')
    def test_download_and_mount_files_api_error(self, mock_get, mock_settings):
        """Test _download_and_mount_files handles API errors."""
        mock_settings.MICROSANDBOX_DOCUMENT_SERVER_URL = "https://test-server"

        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.text = "Server error"
        mock_get.return_value = mock_response

        manager = SandboxCallbackManager("session123", [])
        manager.encoded_brain_docs = "encoded_docs"

        args = {'config': {}}
        manager._download_and_mount_files(args)

        # Should not add volumes on error
        assert 'volumes' not in args['config']

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.requests.get')
    def test_download_and_mount_files_timeout(self, mock_get, mock_settings):
        """Test _download_and_mount_files handles timeout."""
        mock_settings.MICROSANDBOX_DOCUMENT_SERVER_URL = "https://test-server"

        mock_get.side_effect = requests.exceptions.Timeout()

        manager = SandboxCallbackManager("session123", [])
        manager.encoded_brain_docs = "encoded_docs"

        args = {'config': {}}
        manager._download_and_mount_files(args)

        # Should handle timeout gracefully
        assert 'volumes' not in args['config']

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    def test_handle_sandbox_stop(self, mock_get_settings):
        """Test _handle_sandbox_stop calls file watcher stop."""
        mock_settings = Mock()
        mock_get_settings.return_value = mock_settings

        manager = SandboxCallbackManager("session123", [])

        with patch.object(manager, '_stop_file_watcher') as mock_stop:
            manager._handle_sandbox_stop()
            mock_stop.assert_called_once()

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.requests.post')
    def test_stop_file_watcher_success(self, mock_post, mock_settings):
        """Test _stop_file_watcher successful operation."""
        mock_settings.MICROSANDBOX_DOCUMENT_SERVER_URL = "https://test-server"

        manager = SandboxCallbackManager("session123", [])
        manager._stop_file_watcher()

        mock_post.assert_called_once_with("https://test-server/watcher/session123/stop")

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.get_settings')
    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.requests.post')
    def test_stop_file_watcher_exception(self, mock_post, mock_get_settings):
        """Test _stop_file_watcher handles exceptions."""
        mock_settings = Mock()
        mock_settings.MICROSANDBOX_DOCUMENT_SERVER_URL = "https://test-server"
        mock_get_settings.return_value = mock_settings

        mock_post.side_effect = Exception("Connection error")

        manager = SandboxCallbackManager("session123", [])
        # Should not raise exception
        manager._stop_file_watcher()


class TestCreateSandboxCallbacks:
    """Test cases for create_sandbox_callbacks function."""

    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.SandboxCallbackManager')
    @patch('src.smart_rag.infrastructure.processing.sandbox_callbacks.settings')
    def test_create_sandbox_callbacks(self, mock_settings, mock_manager_class):
        """Test create_sandbox_callbacks factory function."""
        mock_settings.MICROSANDBOX_MCP_URL = "https://test-url"

        mock_manager = Mock()
        mock_before_callback = Mock()
        mock_after_callback = Mock()

        mock_manager.create_before_tool_callback.return_value = mock_before_callback
        mock_manager.create_after_tool_callback.return_value = mock_after_callback
        mock_manager_class.return_value = mock_manager

        session_id = "session123"
        brain_docs = [{"id": "doc1"}]
        conversation_workspace_name = "brain_456"

        result = create_sandbox_callbacks(session_id, brain_docs, conversation_workspace_name)

        # Verify manager was created correctly
        mock_manager_class.assert_called_once_with(session_id, brain_docs, conversation_workspace_name)

        # Verify callbacks were created
        mock_manager.create_before_tool_callback.assert_called_once()
        mock_manager.create_after_tool_callback.assert_called_once()

        # Verify result
        assert result == (mock_before_callback, mock_after_callback)
        assert len(result) == 2
        assert callable(result[0])
        assert callable(result[1])
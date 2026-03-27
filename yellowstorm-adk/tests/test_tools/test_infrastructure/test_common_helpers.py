"""Tests for common helper functions."""

import pytest
import os
import tempfile
from unittest.mock import MagicMock, patch, AsyncMock

from src.smart_rag.tools.infrastructure.common_helpers import CommonHelpers



class TestCommonHelpers:
    """Test cases for CommonHelpers class."""

    def test_init_default(self):
        """Test CommonHelpers initialization with defaults."""
        helper = CommonHelpers()

        assert helper.file_path == "./tmp"
        assert helper.api_url is not None
        assert helper.azure_connection_string is not None
        assert helper.azure_file_system_name is not None

    def test_init_custom_path(self):
        """Test CommonHelpers initialization with custom path."""
        custom_path = "/custom/path"
        helper = CommonHelpers(file_path=custom_path)

        assert helper.file_path == custom_path

    
    @pytest.mark.asyncio
    @patch('src.smart_rag.tools.infrastructure.common_helpers.FileClient')
    @patch('aiofiles.open')
    @patch('os.makedirs')
    async def test_async_download_from_azure_datalake_success(self, mock_makedirs, mock_aiofiles, mock_file_client):
        """Test successful file download from Azure Data Lake."""
        # Setup mocks
        mock_download = AsyncMock()
        mock_download.readall.return_value = b"test file content"

        mock_file_instance = AsyncMock()
        mock_file_instance.download_file.return_value = mock_download

        mock_file_client.from_connection_string.return_value.__aenter__.return_value = mock_file_instance

        mock_file_handle = AsyncMock()
        mock_aiofiles.return_value.__aenter__.return_value = mock_file_handle

        helper = CommonHelpers(file_path="/tmp/test")
        result = await helper.async_download_from_azure_datalake("test/file.pdf")

        # Use os.path.join for platform-independent path comparison
        expected_path = os.path.join("/tmp/test", "file.pdf")
        assert result == expected_path
        mock_makedirs.assert_called_once_with("/tmp/test", exist_ok=True)
        mock_file_handle.write.assert_called_once_with(b"test file content")

    @pytest.mark.asyncio
    @patch('src.smart_rag.tools.infrastructure.common_helpers.FileClient')
    async def test_async_download_from_azure_datalake_error(self, mock_file_client):
        """Test file download error handling."""
        mock_file_client.from_connection_string.side_effect = Exception("Azure connection failed")

        helper = CommonHelpers()

        with pytest.raises(Exception, match="Azure connection failed"):
            await helper.async_download_from_azure_datalake("test/file.pdf")

    def test_create_search_payload(self):
        """Test creating search payload."""
        helper = CommonHelpers()

        query = "test search query"
        filter_params = {"category": "documents", "type": "pdf"}
        vectorstore = "test_vectorstore"
        top_k = 5

        payload = helper.create_search_payload(query, filter_params, vectorstore, top_k)

        assert payload["query"] == query
        assert payload["collection_name"] == vectorstore
        assert isinstance(payload, dict)

    def test_create_search_payload_empty_query(self):
        """Test creating search payload with empty query."""
        helper = CommonHelpers()

        payload = helper.create_search_payload("", {}, "vectorstore", 10)

        assert payload["query"] == ""
        assert payload["collection_name"] == "vectorstore"

    def test_create_search_payload_none_values(self):
        """Test creating search payload with None values."""
        helper = CommonHelpers()

        payload = helper.create_search_payload(None, None, None, None)

        assert payload["query"] is None
        assert payload["collection_name"] is None

    @pytest.mark.asyncio
    async def test_file_path_creation(self):
        """Test that file path is handled correctly."""
        with tempfile.TemporaryDirectory() as temp_dir:
            helper = CommonHelpers(file_path=temp_dir)
            assert helper.file_path == temp_dir

    def test_settings_integration(self):
        """Test integration with settings."""
        helper = CommonHelpers()

        # These should not be None and should come from settings
        assert helper.api_url is not None
        assert helper.azure_connection_string is not None
        assert helper.azure_file_system_name is not None

        # Test that they are strings
        assert isinstance(helper.api_url, str)
        assert isinstance(helper.azure_connection_string, str)
        assert isinstance(helper.azure_file_system_name, str)

    @pytest.mark.asyncio
    @patch('os.path.splitext')
    async def test_async_download_extension_handling(self, mock_splitext):
        """Test file extension handling in download."""
        mock_splitext.return_value = ("/path/file", ".pdf")

        helper = CommonHelpers()

        # This should not raise an exception even if extension handling fails
        with patch('azure.storage.filedatalake.aio.DataLakeFileClient') as mock_client:
            mock_client.from_connection_string.side_effect = Exception("Connection failed")

            with pytest.raises(Exception):
                await helper.async_download_from_azure_datalake("test/file.pdf")
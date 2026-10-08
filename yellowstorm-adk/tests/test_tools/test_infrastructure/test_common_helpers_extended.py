"""Extended unit tests for CommonHelpers."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.tools.infrastructure.common_helpers import CommonHelpers


class TestCommonHelpersExtended:
    def test_has_ceph_config_false_by_default(self):
        helper = CommonHelpers()
        assert helper._has_ceph_config() is False

    def test_normalize_object_key(self):
        helper = CommonHelpers()
        helper.ceph_bucket_name = "bucket"
        helper.ceph_endpoint = "https://ceph.example.com"
        helper.azure_file_system_name = "container"

        assert helper._normalize_object_key("s3://bucket/path/file.pdf") == "path/file.pdf"
        assert helper._normalize_object_key("bucket/path/file.pdf") == "path/file.pdf"
        assert (
            helper._normalize_object_key("https://ceph.example.com/bucket/path/file.pdf")
            == "path/file.pdf"
        )
        # The Azure container counts too, so a path written while on azure also strips.
        assert helper._normalize_object_key("container/path/file.pdf") == "path/file.pdf"
        assert (
            helper._normalize_object_key(
                "https://acct.blob.core.windows.net/container/path/file.pdf"
            )
            == "path/file.pdf"
        )
        # Idempotent, and an unknown leading segment is left alone.
        assert helper._normalize_object_key("path/file.pdf") == "path/file.pdf"
        assert helper._normalize_object_key("other/path/file.pdf") == "other/path/file.pdf"

    @pytest.mark.asyncio
    async def test_azure_download_normalizes_the_key(self):
        """A path carrying a container prefix must reach Azure as a bare key."""
        helper = CommonHelpers()
        helper.ceph_bucket_name = "bucket"
        helper.azure_connection_string = "UseDevelopmentStorage=true"
        helper.azure_file_system_name = "container"

        with patch(
            "src.smart_rag.tools.infrastructure.common_helpers.FileClient"
        ) as mock_file_client, patch("aiofiles.open"), patch("os.makedirs"):
            client = AsyncMock()
            client.download_file.return_value = AsyncMock(
                readall=AsyncMock(return_value=b"data")
            )
            mock_file_client.from_connection_string.return_value.__aenter__.return_value = client

            await helper.async_download_from_azure_datalake("bucket/path/file.pdf")

        assert (
            mock_file_client.from_connection_string.call_args.kwargs["file_path"]
            == "path/file.pdf"
        )

    def test_build_ceph_get_headers(self):
        helper = CommonHelpers()
        helper.ceph_endpoint = "https://ceph.example.com"
        helper.ceph_bucket_name = "bucket"
        helper.ceph_access_key_id = "key"
        helper.ceph_secret_access_key = "secret"
        helper.ceph_region = "us-east-1"
        headers = helper._build_ceph_get_headers("path/file.pdf")
        assert "Authorization" in headers
        assert headers["x-amz-content-sha256"] == "UNSIGNED-PAYLOAD"

    @pytest.mark.asyncio
    async def test_async_download_from_storage_uses_azure_when_no_ceph(self):
        helper = CommonHelpers()
        with patch.object(helper, "async_download_from_azure_datalake", new_callable=AsyncMock) as mock_az:
            mock_az.return_value = "/tmp/file.pdf"
            path = await helper.async_download_from_storage("docs/file.pdf")
        mock_az.assert_awaited_once_with("docs/file.pdf")
        assert path == "/tmp/file.pdf"

    @staticmethod
    def _with_ceph(helper: CommonHelpers) -> CommonHelpers:
        helper.ceph_endpoint = "https://ceph.example.com"
        helper.ceph_bucket_name = "bucket"
        helper.ceph_access_key_id = "key"
        helper.ceph_secret_access_key = "secret"
        return helper

    @pytest.mark.asyncio
    async def test_async_download_from_storage_prefers_ceph_when_configured(self):
        """With Ceph credentials present and no provider set, Ceph wins."""
        helper = self._with_ceph(CommonHelpers())
        helper.storage_provider = "ceph"

        with patch.object(helper, "async_download_from_ceph_s3", new_callable=AsyncMock) as mock_ceph, \
             patch.object(helper, "async_download_from_azure_datalake", new_callable=AsyncMock) as mock_az:
            mock_ceph.return_value = "/tmp/file.pdf"
            path = await helper.async_download_from_storage("docs/file.pdf")

        mock_ceph.assert_awaited_once_with("docs/file.pdf")
        mock_az.assert_not_awaited()
        assert path == "/tmp/file.pdf"

    @pytest.mark.asyncio
    async def test_storage_provider_azure_wins_over_present_ceph_config(self):
        """STORAGE_PROVIDER=azure must switch over without stripping CEPH_* first."""
        helper = self._with_ceph(CommonHelpers())
        helper.storage_provider = "azure"

        with patch.object(helper, "async_download_from_ceph_s3", new_callable=AsyncMock) as mock_ceph, \
             patch.object(helper, "async_download_from_azure_datalake", new_callable=AsyncMock) as mock_az:
            mock_az.return_value = "/tmp/file.pdf"
            path = await helper.async_download_from_storage("docs/file.pdf")

        mock_az.assert_awaited_once_with("docs/file.pdf")
        mock_ceph.assert_not_awaited()
        assert path == "/tmp/file.pdf"

    def test_filter_ids_with_mapping(self):
        helper = CommonHelpers()
        mapping = {"category": {"finance": ["doc-1", "doc-2"]}}
        filtered = helper.filter_ids({"category": ["finance"]}, mapping)
        assert "doc-1" in filtered

    @pytest.mark.asyncio
    async def test_post_vectorstore_vector_search(self):
        helper = CommonHelpers()
        with patch(
            "src.smart_rag.tools.infrastructure.common_helpers.similarity_search_with_score_task_async",
            new_callable=AsyncMock,
            return_value=[({"page_content": "hit"}, 0.9)],
        ):
            result = await helper.post_vectorstore(
                "token",
                {"collection_name": "vs", "query": "q", "top_k": 4, "filter": {}},
            )
        assert result[0][0]["page_content"] == "hit"

    def test_validate_metadata_and_extract_filename(self):
        helper = CommonHelpers()
        item = {"metadata": {"source": "a.pdf", "page": 1}}
        assert helper.validate_metadata(item, ["source"]) is True
        assert helper.extract_filename_from_path("/path/file.pdf") == "file.pdf"

    @pytest.mark.asyncio
    async def test_post_vectorstore_hybrid_search(self):
        helper = CommonHelpers()
        with patch(
            "src.smart_rag.tools.infrastructure.common_helpers.hybrid_search_with_score_task_async",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_hybrid:
            result = await helper.post_vectorstore(
                "token",
                {
                    "collection_name": "vs",
                    "query": "q",
                    "search_type": "hybrid_search",
                    "filter": {},
                },
            )
        mock_hybrid.assert_awaited_once()
        assert result == []

    def test_create_text_object(self):
        helper = CommonHelpers()
        item = {
            "page_content": "Revenue up",
            "metadata": {"source": "report.pdf", "page": 2, "workspace_name": "w1"},
        }
        obj = helper.create_text_object(item)
        assert obj["content"]["source"] == "report.pdf"
        assert obj["content"]["page"] == 2


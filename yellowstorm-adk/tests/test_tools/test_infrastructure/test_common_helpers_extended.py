"""Extended unit tests for CommonHelpers."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.tools.infrastructure.common_helpers import CommonHelpers


class TestCommonHelpersExtended:
    def test_has_ceph_config_false_by_default(self):
        helper = CommonHelpers()
        assert helper._has_ceph_config() is False

    def test_normalize_ceph_object_key(self):
        helper = CommonHelpers()
        helper.ceph_bucket_name = "bucket"
        helper.ceph_endpoint = "https://ceph.example.com"
        assert helper._normalize_ceph_object_key("s3://bucket/path/file.pdf") == "path/file.pdf"
        assert helper._normalize_ceph_object_key("bucket/path/file.pdf") == "path/file.pdf"

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


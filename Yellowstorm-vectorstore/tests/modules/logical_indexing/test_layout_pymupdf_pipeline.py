"""
Unit tests for layout_pymupdf_pipeline.py.
"""
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from src.modules.logical_indexing.layout_pymupdf_pipeline import LayoutPyMuPDFPipeline


class TestLayoutPyMuPDFPipeline:
    @pytest.mark.asyncio
    @patch("src.modules.logical_indexing.layout_pymupdf_pipeline.get_page_count", return_value=1)
    @patch("src.modules.logical_indexing.layout_pymupdf_pipeline.split_pdf_with_overlap_to_files")
    async def test_process_pdf_async_handles_zero_overlap_full_page_regions(
        self,
        mock_splitter,
        mock_get_page_count,
    ):
        mock_splitter.return_value = iter([(0, "top", "page_0_top.png")])

        pipeline = LayoutPyMuPDFPipeline(layout_api_url=None)
        pipeline.detect_blocks = lambda *_args, **_kwargs: []

        result = await pipeline.process_pdf_async("dummy.pdf", dpi=144)

        assert len(result) == 1
        assert result[0]["res"]["page_index"] == 0
        mock_splitter.assert_called_once()

"""
Unit tests for pdf_splitter.py.
"""
import os
import sys
from unittest.mock import MagicMock, patch

import fitz

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.utils.pdf_splitter import split_pdf_with_overlap, split_pdf_with_overlap_to_files


class _FakeDoc:
    def __init__(self, page_count=2):
        self._pages = [MagicMock(rect=fitz.Rect(0, 0, 100, 200)) for _ in range(page_count)]

    def __len__(self):
        return len(self._pages)

    def load_page(self, page_num):
        return self._pages[page_num]

    def close(self):
        return None


def _renderable_pixmap():
    pixmap = MagicMock()
    pixmap.width = 100
    pixmap.height = 200
    return pixmap


class TestSplitPdfWithOverlap:
    @patch("src.utils.pdf_splitter._render_page_with_fallbacks")
    @patch("src.utils.pdf_splitter.fitz.open")
    def test_zero_overlap_yields_full_pages_only(self, mock_open, mock_render):
        mock_open.return_value = _FakeDoc(page_count=2)
        mock_render.side_effect = [_renderable_pixmap(), _renderable_pixmap()]

        result = list(split_pdf_with_overlap("dummy.pdf", overlap_ratio=0.0, dpi=144))

        assert len(result) == 2
        assert all(region_type == "top" for _, region_type, _ in result)
        assert [page_num for page_num, _, _ in result] == [0, 1]

    @patch("src.utils.pdf_splitter._render_page_with_fallbacks")
    @patch("src.utils.pdf_splitter.fitz.open")
    def test_positive_overlap_keeps_bottom_regions(self, mock_open, mock_render):
        mock_open.return_value = _FakeDoc(page_count=2)
        mock_render.side_effect = [
            _renderable_pixmap(),
            _renderable_pixmap(),
            _renderable_pixmap(),
        ]

        result = list(split_pdf_with_overlap("dummy.pdf", overlap_ratio=0.1, dpi=144))

        assert [region_type for _, region_type, _ in result] == ["top", "top", "bottom"]
        assert result[-1][0] == 0


class TestSplitPdfWithOverlapToFiles:
    @patch("src.utils.pdf_splitter.split_pdf_with_overlap")
    def test_skips_zero_sized_pixmaps_before_save(self, mock_splitter, tmp_path):
        bad_pixmap = MagicMock()
        bad_pixmap.width = 0
        bad_pixmap.height = 100

        good_pixmap = MagicMock()
        good_pixmap.width = 100
        good_pixmap.height = 100
        good_pixmap.save.side_effect = lambda path: open(path, "wb").write(b"png")

        mock_splitter.return_value = iter([
            (0, "top", bad_pixmap),
            (1, "top", good_pixmap),
        ])

        result = list(
            split_pdf_with_overlap_to_files(
                "dummy.pdf",
                output_dir=tmp_path,
                overlap_ratio=0.0,
                dpi=144,
            )
        )

        assert len(result) == 1
        assert result[0][0:2] == (1, "top")
        bad_pixmap.save.assert_not_called()
        good_pixmap.save.assert_called_once()

"""
Unit tests for tasks.py helper functions.
"""
import pytest
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from src.modules.logical_indexing.tasks import (
    _resolve_language_name,
    _validate_and_get_page_image,
    _normalize_embedding,
    _process_single_image,
    _process_images_for_document,
    _DPI_SCALE,
)


class TestNormalizeEmbedding:
    def test_converts_to_float_list(self):
        result = _normalize_embedding([1.0, 2.5, 3.7])
        assert result == [1.0, 2.5, 3.7]
        assert all(isinstance(v, float) for v in result)

    def test_converts_int_values(self):
        result = _normalize_embedding([1, 2, 3])
        assert result == [1.0, 2.0, 3.0]

    def test_empty_list(self):
        assert _normalize_embedding([]) == []


class TestResolveLanguageName:
    def test_valid_language_code(self):
        assert _resolve_language_name("en") == "English"

    def test_french(self):
        assert _resolve_language_name("fr") == "French"

    def test_invalid_contains_raw(self):
        assert "invalid_code_xyz" in _resolve_language_name("invalid_code_xyz")

    @patch("src.modules.logical_indexing.tasks.Language")
    def test_exception_returns_raw(self, mock_lang):
        mock_lang.make.side_effect = Exception("broken")
        assert _resolve_language_name("en") == "en"


class TestValidateAndGetPageImage:
    def _make_img(self, page=0, bbox=None):
        b = MagicMock()
        b.id = f"p{page}_b0"
        b.page = page
        b.bbox = bbox or [10, 20, 30, 40]
        return b

    def test_valid(self):
        with patch("os.path.exists", return_value=True):
            r = _validate_and_get_page_image(self._make_img(bbox=[100, 200, 300, 400]), ["/tmp/p.png"], _DPI_SCALE)
        assert r is not None

    def test_empty_bbox(self):
        assert _validate_and_get_page_image(self._make_img(bbox=[]), ["/tmp/x"], _DPI_SCALE) is None

    def test_short_bbox(self):
        assert _validate_and_get_page_image(self._make_img(bbox=[1, 2]), ["/tmp/x"], _DPI_SCALE) is None

    def test_none_bbox(self):
        img = self._make_img()
        img.bbox = None
        assert _validate_and_get_page_image(img, ["/tmp/x"], _DPI_SCALE) is None

    def test_page_out_of_range(self):
        assert _validate_and_get_page_image(self._make_img(page=5), ["/tmp/x"], _DPI_SCALE) is None

    def test_file_not_found(self):
        assert _validate_and_get_page_image(self._make_img(), ["/nope"], _DPI_SCALE) is None

    def test_second_page(self):
        with patch("os.path.exists", return_value=True):
            r = _validate_and_get_page_image(self._make_img(page=1), ["/a", "/b"], _DPI_SCALE)
        assert r is not None


class TestProcessSingleImage:
    def _make_img(self):
        b = MagicMock()
        b.id = "p0_b3"
        b.label = "image"
        b.page = 0
        b.bbox = [100, 200, 300, 400]
        return b

    @patch("src.modules.logical_indexing.tasks.Image.open")
    @patch("src.modules.logical_indexing.tasks.describe_image", return_value="desc")
    @patch("src.modules.logical_indexing.tasks.upload_to_azure_datalake")
    @patch("src.modules.logical_indexing.tasks.create_compressed_image", return_value="/tmp/c.jpeg")
    def test_full(self, mock_comp, mock_up, mock_desc, mock_img):
        m = MagicMock()
        m.__enter__ = MagicMock(return_value=m)
        m.__exit__ = MagicMock(return_value=False)
        m.size = (654, 356)
        mock_img.return_value = m

        r = _process_single_image("/tmp/crop.png", "dl/dir", "English", "u1", self._make_img(), {"p0_b3": "p0_b1"})
        assert r["image_id"] == "p0_b3"
        assert r["section_id"] == "p0_b1"
        assert r["description"] == "desc"
        assert r["image_compressed_path"] == "dl/dir/c.jpeg"
        assert r["dimensions"] == {"width": 654, "height": 356}
        assert mock_up.call_count == 2

    @patch("src.modules.logical_indexing.tasks.Image.open", side_effect=Exception("x"))
    @patch("src.modules.logical_indexing.tasks.describe_image", return_value="d")
    @patch("src.modules.logical_indexing.tasks.upload_to_azure_datalake")
    @patch("src.modules.logical_indexing.tasks.create_compressed_image", return_value=None)
    def test_no_compressed(self, mock_comp, mock_up, mock_desc, mock_img):
        r = _process_single_image("/tmp/c.png", "dl", "En", "u1", self._make_img(), {})
        assert r["image_compressed_path"] is None
        assert r["dimensions"] == {"width": 0, "height": 0}
        assert mock_up.call_count == 1


class TestProcessImagesForDocument:
    def test_no_images(self):
        doc = MagicMock()
        doc.images = {}
        assert _process_images_for_document(doc, "/tmp/t.pdf", "/tmp", "dl", "en") == []

    @patch("src.modules.logical_indexing.tasks.extract_sub_image", return_value=["/tmp/c.png"])
    @patch("src.modules.logical_indexing.tasks._process_single_image")
    @patch("src.modules.logical_indexing.tasks._validate_and_get_page_image")
    @patch("src.modules.logical_indexing.tasks.convert_pdf_to_images", return_value=["/tmp/p.png"])
    @patch("src.modules.logical_indexing.tasks._assign_images_to_sections", return_value={})
    def test_with_image(self, mock_a, mock_c, mock_v, mock_s, mock_e):
        mock_v.return_value = ("/tmp/p.png", {"x1": 1, "y1": 2, "x2": 3, "y2": 4})
        mock_s.return_value = {"image_id": "x", "section_id": None, "label": "image",
                               "description": "d", "image_path": "p", "image_compressed_path": None,
                               "bbox": {}, "page_number": 0, "dimensions": {}}
        ib = MagicMock()
        ib.id = "p0_b3"
        ib.page = 0
        ib.bbox = [1, 2, 3, 4]
        ib.label = "image"
        doc = MagicMock()
        doc.images = {"p0_b3": ib}
        doc.blocks = {}
        r = _process_images_for_document(doc, "/tmp/t.pdf", "/tmp", "dl", "en")
        assert len(r) == 1

    @patch("src.modules.logical_indexing.tasks._validate_and_get_page_image", return_value=None)
    @patch("src.modules.logical_indexing.tasks.convert_pdf_to_images", return_value=["/tmp/p.png"])
    @patch("src.modules.logical_indexing.tasks._assign_images_to_sections", return_value={})
    def test_skip_on_validation(self, mock_a, mock_c, mock_v):
        ib = MagicMock()
        ib.id = "p0_b3"
        ib.page = 0
        ib.bbox = [1, 2, 3, 4]
        ib.label = "image"
        doc = MagicMock()
        doc.images = {"p0_b3": ib}
        doc.blocks = {}
        assert _process_images_for_document(doc, "/tmp/t.pdf", "/tmp", "dl", "en") == []

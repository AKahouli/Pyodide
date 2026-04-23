"""
Unit tests for doc_outline_v2.py helper functions.
Tests cover _classify_label, _build_block, extract_blocks_from_page,
_find_heading_for_image, _assign_images_to_sections.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from src.modules.logical_indexing.doc_outline_v2 import (
    _classify_label,
    _build_block,
    extract_blocks_from_page,
    _find_heading_for_image,
    _assign_images_to_sections,
    IMAGE_LABELS,
    IGNORED_LABELS,
    Block,
)


class TestClassifyLabel:
    def test_image_label(self):
        node_type, heading_level, is_image = _classify_label("image")
        assert node_type == "image"
        assert heading_level is None
        assert is_image is True

    def test_figure_label(self):
        node_type, heading_level, is_image = _classify_label("figure")
        assert node_type == "image"
        assert is_image is True

    def test_chart_label(self):
        node_type, heading_level, is_image = _classify_label("chart")
        assert node_type == "image"
        assert is_image is True

    def test_doc_title_heading(self):
        node_type, heading_level, is_image = _classify_label("doc_title")
        assert node_type == "heading"
        assert heading_level == 1
        assert is_image is False

    def test_abstract_heading(self):
        node_type, heading_level, is_image = _classify_label("abstract")
        assert node_type == "heading"
        assert heading_level == 2

    def test_paragraph_title_heading(self):
        node_type, heading_level, is_image = _classify_label("paragraph_title")
        assert node_type == "heading"
        assert heading_level == 3

    def test_meta_label(self):
        node_type, heading_level, is_image = _classify_label("figure_caption")
        assert node_type == "meta"
        assert heading_level is None
        assert is_image is False

    def test_table_caption_meta(self):
        node_type, heading_level, is_image = _classify_label("table_caption")
        assert node_type == "meta"

    def test_text_content(self):
        node_type, heading_level, is_image = _classify_label("text")
        assert node_type == "content"
        assert heading_level is None
        assert is_image is False

    def test_table_content(self):
        node_type, heading_level, is_image = _classify_label("table")
        assert node_type == "content"
        assert is_image is False

    def test_unknown_label_defaults_to_content(self):
        node_type, heading_level, is_image = _classify_label("something_else")
        assert node_type == "content"
        assert heading_level is None
        assert is_image is False


class TestBuildBlock:
    def test_basic_text_block(self):
        item = {
            "block_label": "text",
            "block_content": "Hello world",
            "block_bbox": [10, 20, 30, 40],
            "block_id": 5,
        }
        block = _build_block(item, 2, "content", None, False)
        assert block.id == "p2_b5"
        assert block.page == 2
        assert block.label == "text"
        assert block.node_type == "content"
        assert block.text == "Hello world"
        assert block.bbox == [10, 20, 30, 40]

    def test_image_block_preserves_bbox(self):
        item = {
            "block_label": "image",
            "block_content": "",
            "block_bbox": [100, 200, 300, 400],
            "block_id": 3,
        }
        block = _build_block(item, 0, "image", None, True)
        assert block.bbox == [100, 200, 300, 400]
        assert block.node_type == "image"
        assert block.text is None

    def test_meta_block_preserves_bbox(self):
        item = {
            "block_label": "figure_caption",
            "block_content": "Fig 1: Example",
            "block_bbox": [5, 10, 15, 20],
            "block_id": 1,
        }
        block = _build_block(item, 1, "meta", None, False)
        assert block.bbox == [5, 10, 15, 20]
        assert block.node_type == "meta"

    def test_heading_block(self):
        item = {
            "block_label": "doc_title",
            "block_content": "My Document",
            "block_bbox": [],
            "block_id": 0,
        }
        block = _build_block(item, 0, "heading", 1, False)
        assert block.heading_level == 1
        assert block.text == "My Document"

    def test_empty_content_becomes_none(self):
        item = {
            "block_label": "text",
            "block_content": "",
            "block_bbox": [],
            "block_id": 0,
        }
        block = _build_block(item, 0, "content", None, False)
        assert block.text is None

    def test_non_list_bbox_returns_empty(self):
        item = {
            "block_label": "text",
            "block_content": "hello",
            "block_bbox": "not_a_list",
            "block_id": 0,
        }
        block = _build_block(item, 0, "content", None, False)
        assert block.bbox == []


class TestExtractBlocksFromPage:
    def _make_page_entry(self, blocks, page_index=0):
        return {
            "res": {
                "page_index": page_index,
                "parsing_res_list": blocks,
            }
        }

    def test_no_res_key_returns_empty(self):
        blocks, images = extract_blocks_from_page({})
        assert blocks == []
        assert images == []

    def test_empty_parsing_list(self):
        entry = self._make_page_entry([])
        blocks, images = extract_blocks_from_page(entry)
        assert blocks == []
        assert images == []

    def test_text_block_extracted(self):
        entry = self._make_page_entry([
            {"block_label": "text", "block_content": "Hello", "block_bbox": [1, 2, 3, 4], "block_id": 0}
        ])
        blocks, images = extract_blocks_from_page(entry)
        assert len(blocks) == 1
        assert len(images) == 0
        assert blocks[0].label == "text"

    def test_image_block_separated(self):
        entry = self._make_page_entry([
            {"block_label": "image", "block_content": "", "block_bbox": [10, 20, 30, 40], "block_id": 0}
        ])
        blocks, images = extract_blocks_from_page(entry)
        assert len(blocks) == 0
        assert len(images) == 1
        assert images[0].label == "image"
        assert images[0].bbox == [10, 20, 30, 40]

    def test_skipped_labels_filtered(self):
        entry = self._make_page_entry([
            {"block_label": "header", "block_content": "Header", "block_bbox": [], "block_id": 0},
            {"block_label": "footer", "block_content": "Footer", "block_bbox": [], "block_id": 1},
            {"block_label": "seal", "block_content": "", "block_bbox": [], "block_id": 2},
        ])
        blocks, images = extract_blocks_from_page(entry)
        assert len(blocks) == 0
        assert len(images) == 0

    def test_mixed_blocks(self):
        entry = self._make_page_entry([
            {"block_label": "doc_title", "block_content": "Title", "block_bbox": [], "block_id": 0},
            {"block_label": "text", "block_content": "Body", "block_bbox": [], "block_id": 1},
            {"block_label": "image", "block_content": "", "block_bbox": [1, 2, 3, 4], "block_id": 2},
            {"block_label": "figure", "block_content": "", "block_bbox": [5, 6, 7, 8], "block_id": 3},
        ])
        blocks, images = extract_blocks_from_page(entry)
        assert len(blocks) == 2
        assert len(images) == 2

    def test_page_index_used_in_block_id(self):
        entry = self._make_page_entry(
            [{"block_label": "text", "block_content": "X", "block_bbox": [], "block_id": 7}],
            page_index=5,
        )
        blocks, images = extract_blocks_from_page(entry)
        assert blocks[0].id == "p5_b7"
        assert blocks[0].page == 5


class TestFindHeadingForImage:
    def _make_block(self, block_id, page, bbox_y):
        return Block(
            id=block_id, page=page, label="paragraph_title",
            node_type="heading", heading_level=3,
            bbox=[0, bbox_y, 100, bbox_y + 20],
            text=f"Heading {block_id}", section_path=[],
        )

    def _make_image(self, block_id, page, bbox_y):
        return Block(
            id=block_id, page=page, label="image",
            node_type="image", heading_level=None,
            bbox=[0, bbox_y, 50, bbox_y + 10],
            text=None, section_path=[],
        )

    def test_image_after_heading_on_same_page(self):
        h1 = self._make_block("h1", 0, 10)
        img = self._make_image("img1", 0, 50)
        result = _find_heading_for_image(img, [h1])
        assert result is not None
        assert result.id == "h1"

    def test_image_before_heading_on_same_page(self):
        h1 = self._make_block("h1", 0, 100)
        img = self._make_image("img1", 0, 50)
        result = _find_heading_for_image(img, [h1])
        assert result is None

    def test_image_on_different_page(self):
        h1 = self._make_block("h1", 0, 10)
        img = self._make_image("img1", 1, 50)
        result = _find_heading_for_image(img, [h1])
        assert result is not None
        assert result.id == "h1"

    def test_image_page_past_all_headings(self):
        h1 = self._make_block("h1", 2, 10)
        img = self._make_image("img1", 0, 50)
        result = _find_heading_for_image(img, [h1])
        assert result is None

    def test_closest_heading_selected(self):
        h1 = self._make_block("h1", 0, 10)
        h2 = self._make_block("h2", 0, 60)
        img = self._make_image("img1", 0, 80)
        result = _find_heading_for_image(img, [h1, h2])
        assert result.id == "h2"

    def test_no_headings(self):
        img = self._make_image("img1", 0, 50)
        result = _find_heading_for_image(img, [])
        assert result is None

    def test_image_with_no_bbox(self):
        h1 = self._make_block("h1", 0, 10)
        img = Block(id="img1", page=0, label="image", node_type="image",
                     bbox=[], text=None, section_path=[])
        result = _find_heading_for_image(img, [h1])
        assert result is None


class TestAssignImagesToSections:
    def test_empty_images(self):
        result = _assign_images_to_sections([], [])
        assert result == {}

    def test_single_image_assigned(self):
        heading = Block(id="p0_b0", page=0, label="paragraph_title",
                        node_type="heading", heading_level=3,
                        bbox=[0, 10, 100, 30], text="Section 1", section_path=[])
        image = Block(id="p0_b1", page=0, label="image",
                      node_type="image", heading_level=None,
                      bbox=[0, 50, 50, 60], text=None, section_path=[])
        result = _assign_images_to_sections([image], [heading])
        assert result == {"p0_b1": "p0_b0"}

    def test_image_not_assigned_when_no_heading(self):
        image = Block(id="p0_b0", page=0, label="image",
                      node_type="image", heading_level=None,
                      bbox=[0, 50, 50, 60], text=None, section_path=[])
        result = _assign_images_to_sections([image], [])
        assert result == {}

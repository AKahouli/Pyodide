"""
Unit tests for image_index.py functions
Tests for box merging, overlap detection, and area calculation
"""
import pytest
import sys
import os

# Add project root to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from src.modules.indexing.image_index import calculate_area, overlaps, merge_boxes


class TestCalculateArea:
    """Unit tests for calculate_area function"""

    def test_calculate_area_simple_box(self):
        """Test area calculation for a simple box"""
        box = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        result = calculate_area(box)
        assert result == 100

    def test_calculate_area_different_dimensions(self):
        """Test area calculation for boxes with different dimensions"""
        box = {"x1": 5, "y1": 3, "x2": 15, "y2": 8}
        result = calculate_area(box)
        assert result == 50  # (15-5) * (8-3) = 10 * 5

    def test_calculate_area_zero_width(self):
        """Test area calculation for box with zero width"""
        box = {"x1": 5, "y1": 0, "x2": 5, "y2": 10}
        result = calculate_area(box)
        assert result == 0

    def test_calculate_area_zero_height(self):
        """Test area calculation for box with zero height"""
        box = {"x1": 0, "y1": 5, "x2": 10, "y2": 5}
        result = calculate_area(box)
        assert result == 0

    def test_calculate_area_negative_coordinates(self):
        """Test area calculation with negative coordinates"""
        box = {"x1": -5, "y1": -5, "x2": 5, "y2": 5}
        result = calculate_area(box)
        assert result == 100


class TestOverlaps:
    """Unit tests for overlaps function"""

    def test_overlapping_boxes_horizontal(self):
        """Test detection of horizontally overlapping boxes"""
        box_a = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        box_b = {"x1": 5, "y1": 0, "x2": 15, "y2": 10}
        assert overlaps(box_a, box_b) is True

    def test_overlapping_boxes_vertical(self):
        """Test detection of vertically overlapping boxes"""
        box_a = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        box_b = {"x1": 0, "y1": 5, "x2": 10, "y2": 15}
        assert overlaps(box_a, box_b) is True

    def test_overlapping_boxes_both_axes(self):
        """Test detection of boxes overlapping on both axes"""
        box_a = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        box_b = {"x1": 5, "y1": 5, "x2": 15, "y2": 15}
        assert overlaps(box_a, box_b) is True

    def test_non_overlapping_boxes_horizontal(self):
        """Test detection of non-overlapping boxes horizontally"""
        box_a = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        box_b = {"x1": 11, "y1": 0, "x2": 20, "y2": 10}
        assert overlaps(box_a, box_b) is False

    def test_non_overlapping_boxes_vertical(self):
        """Test detection of non-overlapping boxes vertically"""
        box_a = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        box_b = {"x1": 0, "y1": 11, "x2": 10, "y2": 20}
        assert overlaps(box_a, box_b) is False

    def test_touching_boxes(self):
        """Test boxes that touch at an edge are considered overlapping"""
        box_a = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        box_b = {"x1": 10, "y1": 0, "x2": 20, "y2": 10}
        # Boxes that share an edge are considered overlapping for merging purposes
        assert overlaps(box_a, box_b) is True

    def test_contained_box(self):
        """Test when one box is completely inside another"""
        box_a = {"x1": 0, "y1": 0, "x2": 20, "y2": 20}
        box_b = {"x1": 5, "y1": 5, "x2": 15, "y2": 15}
        assert overlaps(box_a, box_b) is True

    def test_identical_boxes(self):
        """Test when boxes are identical"""
        box = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
        assert overlaps(box, box) is True


class TestMergeBoxes:
    """Unit tests for merge_boxes function"""

    def test_merge_boxes_with_list_input(self):
        """Test merge_boxes with list input"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.9},
            {"x1": 5, "y1": 5, "x2": 15, "y2": 15, "name": "box2", "confidence": 0.8}
        ]
        result = merge_boxes(boxes)
        assert len(result) == 1
        assert result[0]["x1"] == 0
        assert result[0]["y1"] == 0
        assert result[0]["x2"] == 15
        assert result[0]["y2"] == 15

    def test_merge_boxes_with_dict_input(self):
        """Test merge_boxes with dict input containing 'detections' key"""
        boxes_dict = {
            "detections": [
                {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.9},
                {"x1": 5, "y1": 5, "x2": 15, "y2": 15, "name": "box2", "confidence": 0.8}
            ]
        }
        result = merge_boxes(boxes_dict)
        assert len(result) == 1
        assert result[0]["x1"] == 0
        assert result[0]["y1"] == 0
        assert result[0]["x2"] == 15
        assert result[0]["y2"] == 15

    def test_merge_boxes_with_dict_empty_detections(self):
        """Test merge_boxes with dict input having empty detections list"""
        boxes_dict = {"detections": []}
        result = merge_boxes(boxes_dict)
        assert result == []

    def test_merge_boxes_with_dict_no_detections_key(self):
        """Test merge_boxes with dict input without 'detections' key"""
        boxes_dict = {"other_key": "value"}
        result = merge_boxes(boxes_dict)
        assert result == []

    def test_merge_boxes_non_overlapping(self):
        """Test merge_boxes with non-overlapping boxes"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.9},
            {"x1": 20, "y1": 20, "x2": 30, "y2": 30, "name": "box2", "confidence": 0.8}
        ]
        result = merge_boxes(boxes)
        assert len(result) == 2
        assert result[0]["name"] == "box1"
        assert result[1]["name"] == "box2"

    def test_merge_boxes_name_from_larger_area(self):
        """Test that merged box takes name from box with larger area"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 20, "y2": 20, "name": "large_box", "confidence": 0.9},
            {"x1": 10, "y1": 10, "x2": 15, "y2": 15, "name": "small_box", "confidence": 0.8}
        ]
        result = merge_boxes(boxes)
        assert len(result) == 1
        assert result[0]["name"] == "large_box"

    def test_merge_boxes_name_from_smaller_area_when_smaller_wins(self):
        """Test that merged box takes name from box with larger area (smaller box name)"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 5, "y2": 5, "name": "small_box", "confidence": 0.9},
            {"x1": 3, "y1": 3, "x2": 20, "y2": 20, "name": "large_box", "confidence": 0.8}
        ]
        result = merge_boxes(boxes)
        assert len(result) == 1
        assert result[0]["name"] == "large_box"  # large_box has area 289 vs small_box 25

    def test_merge_boxes_confidence_max(self):
        """Test that merged box takes maximum confidence"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.5},
            {"x1": 5, "y1": 5, "x2": 15, "y2": 15, "name": "box2", "confidence": 0.9}
        ]
        result = merge_boxes(boxes)
        assert len(result) == 1
        assert result[0]["confidence"] == 0.9

    def test_merge_boxes_multiple_overlaps(self):
        """Test merging when a box overlaps with multiple other boxes"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.9},
            {"x1": 5, "y1": 0, "x2": 15, "y2": 10, "name": "box2", "confidence": 0.8},
            {"x1": 10, "y1": 0, "x2": 20, "y2": 10, "name": "box3", "confidence": 0.7}
        ]
        result = merge_boxes(boxes)
        # box1 overlaps with box2, box2 overlaps with box3
        # box1 and box2 should merge into one, then that overlaps with box3
        assert len(result) == 1
        assert result[0]["x1"] == 0
        assert result[0]["x2"] == 20

    def test_merge_boxes_chain_overlaps(self):
        """Test merging with chain of overlapping boxes"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 5, "y2": 5, "name": "box1", "confidence": 0.9},
            {"x1": 4, "y1": 0, "x2": 9, "y2": 5, "name": "box2", "confidence": 0.8},
            {"x1": 8, "y1": 0, "x2": 13, "y2": 5, "name": "box3", "confidence": 0.7}
        ]
        result = merge_boxes(boxes)
        # All three boxes should merge into one due to chain overlaps
        assert len(result) == 1
        assert result[0]["x1"] == 0
        assert result[0]["x2"] == 13

    def test_merge_boxes_empty_list(self):
        """Test merge_boxes with empty list"""
        result = merge_boxes([])
        assert result == []

    def test_merge_boxes_single_box(self):
        """Test merge_boxes with single box"""
        boxes = [{"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.9}]
        result = merge_boxes(boxes)
        assert len(result) == 1
        assert result[0]["name"] == "box1"

    def test_merge_boxes_preserves_all_merged_boxes(self):
        """Test that merge_boxes preserves all boxes after merging (logic fix verification)"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.9},
            {"x1": 5, "y1": 5, "x2": 15, "y2": 15, "name": "box2", "confidence": 0.8},
            {"x1": 20, "y1": 20, "x2": 30, "y2": 30, "name": "box3", "confidence": 0.7}
        ]
        result = merge_boxes(boxes)
        # box1 and box2 should merge, box3 should remain separate
        assert len(result) == 2
        # First result should be the merged box (box1 + box2)
        assert result[0]["x1"] == 0
        assert result[0]["y1"] == 0
        assert result[0]["x2"] == 15
        assert result[0]["y2"] == 15
        # Second result should be box3 (unchanged)
        assert result[1]["name"] == "box3"

    def test_merge_boxes_partial_overlap(self):
        """Test merging boxes with partial overlap"""
        boxes = [
            {"x1": 0, "y1": 0, "x2": 10, "y2": 10, "name": "box1", "confidence": 0.9},
            {"x1": 8, "y1": 8, "x2": 18, "y2": 18, "name": "box2", "confidence": 0.8}
        ]
        result = merge_boxes(boxes)
        assert len(result) == 1
        assert result[0]["x1"] == 0
        assert result[0]["y1"] == 0
        assert result[0]["x2"] == 18
        assert result[0]["y2"] == 18
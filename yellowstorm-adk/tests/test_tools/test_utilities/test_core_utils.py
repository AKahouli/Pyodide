"""Unit tests for core_utils tree and schema helpers."""

from src.smart_rag.tools.utilities.core_utils import (
    assign_transformed_ids_and_extract_attributes,
    transform_id,
)


class TestCoreUtils:
    def test_transform_id_passthrough(self):
        assert transform_id("node-1") == "node-1"

    def test_assign_transformed_ids_and_extract_attributes(self):
        brain_tree = [
            {
                "id": "b1",
                "name": "Finance",
                "documents": ["doc-a.pdf"],
                "children": [{"id": "b2", "name": "Ops", "documents": []}],
            }
        ]
        attribute_values = {}
        attribute_mapping = {}
        assign_transformed_ids_and_extract_attributes(
            brain_tree, attribute_values, attribute_mapping
        )
        assert "Finance" in attribute_mapping["name"]
        assert "doc-a.pdf" in attribute_mapping["documents"]
        assert "Finance" in attribute_values["name"]

"""Extended unit tests for core_utils."""

from src.smart_rag.tools.utilities.core_utils import (
    assign_transformed_ids_and_extract_attributes,
    build_brain_tree,
    build_tree,
    construct_json,
    transform_id,
)


class TestCoreUtilsExtended:
    def test_transform_id(self):
        assert transform_id("abc") == "abc"

    def test_build_brain_tree_hierarchy(self):
        relations = {
            "nodes": [
                {"id": "root", "name": "Root"},
                {"id": "child", "name": "Child"},
            ],
            "relationships": [{"source": "root", "target": "child"}],
        }
        tree = build_brain_tree(relations)
        assert len(tree) == 1
        assert tree[0]["children"][0]["id"] == "child"

    def test_build_brain_tree_empty(self):
        assert build_brain_tree({}) == []

    def test_assign_transformed_ids_and_extract_attributes(self):
        brain_tree = [{"id": "b1", "name": "Finance", "documents": ["doc-a"], "children": []}]
        attribute_values = {}
        attribute_mapping = {}
        assign_transformed_ids_and_extract_attributes(
            brain_tree, attribute_values, attribute_mapping
        )
        assert attribute_mapping["name"]["Finance"] == ["b1"]
        assert attribute_mapping["documents"]["doc-a"] == ["b1"]

    def test_build_tree_and_construct_json(self):
        documents = [
            {
                "_id": "doc1",
                "filename": "report.pdf",
                "file_name": "report.pdf",
                "workspace_id": "w1",
            }
        ]
        doc_tree, brain_tree = build_tree(documents, {})
        schema, attribute_mapping, brain_mapping = construct_json(doc_tree)
        assert schema["name"]
        assert "_file_name_by_id" in attribute_mapping

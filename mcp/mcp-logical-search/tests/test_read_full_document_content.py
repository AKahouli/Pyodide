import unittest
from types import SimpleNamespace

from src.mcp_server.db_helpers import read_full_document_content


class _Scalars:
    def __init__(self, values):
        self.values = values

    def all(self):
        return self.values

    def first(self):
        return self.values[0] if self.values else None


class _Result:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return _Scalars(self.values)


class _Session:
    def __init__(self, *results):
        self.results = iter(results)

    def execute(self, _statement):
        return _Result(next(self.results))


class ReadFullDocumentContentTests(unittest.TestCase):
    def test_returns_ordered_text_citation_ids_pages_and_unsectioned_blocks(self):
        document = SimpleNamespace(
            id=1,
            user_id="user",
            file_name="report.pdf",
            workspace_id="workspace",
            source="source",
            total_pages=2,
        )
        blocks = [
            SimpleNamespace(
                id=10, block_id="external-10", block_type="text",
                content="Unsectioned opening", page_number=1, section_id=None,
            ),
            SimpleNamespace(
                id=11, block_id="external-11", block_type="text",
                content="Section evidence", page_number=2, section_id="section-a",
            ),
            SimpleNamespace(
                id=12, block_id="external-12", block_type="text",
                content="Section continuation", page_number=3, section_id="section-a",
            ),
        ]
        sections = [SimpleNamespace(id=7, section_id="section-a", title="Findings"),
                    SimpleNamespace(id=8, section_id="empty", title="Empty heading")]
        images = [SimpleNamespace(id="image", content="Chart", image_base64="",
                                  page_number=2, section_id="section-a")]
        session = _Session([document], blocks, images, sections)

        result = read_full_document_content(
            session,
            "report.pdf",
            workspace_id="workspace",
        )

        first, second, empty = result["content"]
        self.assertEqual(first["content"], "[block_id: 10]\nUnsectioned opening")
        self.assertEqual(second["content"],
                         "Findings\n\n[block_id: 11]\nSection evidence\n\n"
                         "[block_id: 12]\nSection continuation")
        self.assertEqual(second["images"][0]["image_id"], "image")
        self.assertEqual(empty, {"content": "Empty heading", "images": []})
        self.assertNotIn("pagination", result)
        self.assertTrue(all(set(chunk) == {"content", "images"} for chunk in result["content"]))


if __name__ == "__main__":
    unittest.main()

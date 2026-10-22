import unittest
from types import SimpleNamespace
from unittest.mock import patch

from src.mcp_server import db_helpers


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalars(self):
        return self

    def first(self):
        return self.value


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class _Session:
    def __init__(self, document, block_rows=()):
        self.document = document
        self.block_rows = list(block_rows)
        self.calls = 0

    def execute(self, statement):
        self.calls += 1
        if self.calls == 1:
            return _ScalarResult(self.document)
        return _Rows(self.block_rows)


class DocumentSummaryOutlineTests(unittest.TestCase):
    @staticmethod
    def _document(total_pages):
        return SimpleNamespace(
            id=7,
            file_name="report.pdf",
            workspace_id="workspace",
            total_pages=total_pages,
        )

    @staticmethod
    def _sections():
        return [
            SimpleNamespace(id=10, section_id="sec_a", title="Introduction"),
            SimpleNamespace(id=11, section_id="sec_b", title="Results"),
        ]

    def test_small_document_uses_first_non_empty_block_per_section(self):
        long_content = "  First   block with spacing " + ("x" * 80)
        session = _Session(self._document(49), [
            ("sec_a", long_content),
            ("sec_a", "Second block must be ignored"),
            ("sec_b", "Short result"),
        ])

        with patch.object(
            db_helpers,
            "get_sections_for_document",
            return_value=self._sections(),
        ):
            result = db_helpers.get_document_summary_outline(
                session,
                "report.pdf",
                workspace_id="workspace",
            )

        first_preview = result["sections"][0]["preview"]
        self.assertLessEqual(len(first_preview), 100)
        self.assertTrue(first_preview.endswith("..."))
        self.assertNotIn("  ", first_preview)
        self.assertEqual(result["sections"][1]["preview"], "Short result")
        self.assertIn("Introduction — ", result["table_of_contents"])
        self.assertNotIn("Second block", result["table_of_contents"])
        self.assertEqual(session.calls, 2)

    def test_fifty_page_document_uses_titles_only(self):
        session = _Session(self._document(50))

        with patch.object(
            db_helpers,
            "get_sections_for_document",
            return_value=self._sections(),
        ):
            result = db_helpers.get_document_summary_outline(
                session,
                "report.pdf",
                workspace_id="workspace",
            )

        self.assertEqual(result["table_of_contents"], "Introduction\nResults")
        self.assertNotIn("preview", result["sections"][0])
        self.assertEqual(session.calls, 1)

    def test_routing_source_uses_content_from_every_section(self):
        session = _Session(self._document(80), [
            ("sec_a", "Architecture facts from the first block."),
            ("sec_a", "Architecture findings from a later block."),
            ("sec_b", "Monitoring procedures and alert thresholds."),
        ])

        with patch.object(
            db_helpers,
            "get_sections_for_document",
            return_value=self._sections(),
        ):
            result = db_helpers.get_document_routing_source(
                session,
                "report.pdf",
                workspace_id="workspace",
            )

        self.assertIn("first block", result["sections"][0]["content"])
        self.assertIn("later block", result["sections"][0]["content"])
        self.assertIn("alert thresholds", result["sections"][1]["content"])
        self.assertEqual(session.calls, 2)

    def test_routing_source_samples_large_sections_across_the_content(self):
        content = "A" * 4000 + "B" * 4000 + "C" * 4000
        sampled = db_helpers._sample_routing_section_content([content])

        self.assertLessEqual(
            len(sampled),
            db_helpers.ROUTING_SECTION_CONTENT_MAX_CHARS,
        )
        self.assertTrue(sampled.startswith("A"))
        self.assertIn("B", sampled)
        self.assertTrue(sampled.endswith("C"))


if __name__ == "__main__":
    unittest.main()

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from src.db.models import LogicalImage
from src.mcp_server import db_helpers as db
from src.mcp_server import logical_indexing_server as server
from src.mcp_server.section_search import search_section_evidence


class ImageSearchTests(unittest.TestCase):
    def test_image_vectors_can_discover_a_section_without_text_or_title_hits(self):
        session = Mock()
        session.execute.return_value.all.side_effect = [
            [("doc", "u", "a.pdf", "ws", None, "simple")], [], [], []]
        key = ("doc", "visual")
        with patch.object(db, "_bm25_section_candidates", return_value=({}, {})), patch.object(
            db, "_bm25_block_candidates", return_value=({}, {})), patch.object(
            db, "_image_vector_candidates", return_value=[("im", *key, .95)]), patch.object(
            db, "_resolve_section_metadata", return_value={key: (42, "Figure")}), patch.object(
            db, "_get_block_contents_by_internal_ids", return_value={}), patch.object(
            db, "_get_image_counts_by_section", return_value={key: 1}):
            result = db.unified_search(session, "three services", [.1], workspace_id="ws")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["section_id"], 42)
        self.assertEqual(result[0]["matched_image"]["image_id"], "im")
        self.assertEqual(result[0]["retrieval_scores"]["content_vector"], .95)
        self.assertIsNone(result[0]["matched_block"])

    def test_image_candidates_preserve_document_scope_and_exclusions_before_limit(self):
        session = Mock()
        session.execute.return_value.all.return_value = []
        db._image_vector_candidates(session, {"doc": {"workspace_id": "ws"}}, [.1], 30,
                                    [("doc", "excluded")])
        statement = session.execute.call_args.args[0]
        sql = str(statement.compile(dialect=postgresql.dialect()))
        self.assertIn("logical_images.document_id IN", sql)
        self.assertIn("NOT IN", sql)
        self.assertIn("logical_images.image_embedding <=>", sql)
        self.assertNotIn("logical_images.embedding", sql)
        self.assertIn(["doc"], statement.compile().params.values())
        self.assertIn([("doc", "excluded")], statement.compile().params.values())
        self.assertNotIn("image_base64", sql)
        self.assertNotIn("logical_images.content", sql)

    def test_image_and_text_signals_reinforce_one_section_with_bounded_score(self):
        visual = db._rrf_score(None, None, 1, include_images=True)
        text = db._rrf_score(1, 1, include_images=True)
        combined = db._rrf_score(1, 1, 1, include_images=True)
        self.assertGreater(combined, visual)
        self.assertGreater(combined, text)
        self.assertAlmostEqual(combined, 1.0)

    def test_visual_evidence_sql_scores_linked_and_standalone_images(self):
        row = SimpleNamespace(section_id=42, _mapping={"section_id": 42, "local_id": "visual",
            "title": "Figure", "document_id": "doc", "file_name": "a.pdf", "workspace_id": "ws"})
        session = Mock()
        session.execute.return_value.all.side_effect = [[row], []]
        search_section_evidence(session, [42], "ws", "services", [.1],
                                preferred_images={42: "im"})
        sql = str(session.execute.call_args_list[1].args[0].compile(dialect=postgresql.dialect()))
        self.assertIn("max(greatest", sql)
        self.assertIn("logical_images.image_embedding <=>", sql)
        self.assertNotIn("logical_images.embedding", sql)
        self.assertIn("NOT (EXISTS", sql)
        self.assertIn("logical_blocks.workspace_id = evidence_scope.workspace_id", sql)
        self.assertNotIn("image_base64", sql)

    def test_discovered_image_is_preferred_during_evidence_hydration(self):
        match = {"section_id": 42, "matched_image": {"image_id": "im", "content": ""}}
        async def run(operation):
            return operation(Mock())
        with patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", False), patch.object(
            server.settings, "SEARCH_FILENAME_SEMANTIC_ENABLED", False), patch.object(
            server, "_run_db", side_effect=run), patch.object(
            server, "unified_search", return_value=[match]), patch.object(
            server, "attach_search_ancestors"), patch.object(
            server, "search_section_evidence", return_value=[]) as evidence:
            asyncio.run(server._run_unified_search("services", [.1], workspace_id="ws",
                        file_name=None, fts_query_variants=None, include_evidence=True))
        self.assertEqual(evidence.call_args.kwargs["preferred_images"], {42: "im"})

    def test_image_reads_do_not_load_stored_visual_vectors(self):
        sql = str(select(LogicalImage).compile(dialect=postgresql.dialect()))
        self.assertNotIn("logical_images.image_embedding", sql)

    def test_section_read_pairs_description_block_with_image_without_duplicate_content(self):
        section = SimpleNamespace(id=42, title="Figure")
        doc = SimpleNamespace(id="doc", source=None, user_id="u", workspace_id="ws", file_name="a.pdf")
        block = SimpleNamespace(id=1, block_type="image", content="Three services", page_number=1, bbox=[1, 2, 3, 4])
        image = SimpleNamespace(id="im", content=None, page_number=1, bbox=block.bbox)
        result = db._format_section_read(section, doc, [block], [image], True, 0, 0, include_images=False)
        self.assertEqual(result["blocks"][0]["image_id"], "im")
        self.assertEqual(result["images"], [])


if __name__ == "__main__":
    unittest.main()

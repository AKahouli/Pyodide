"""Run against an isolated database via TEST_DATABASE_URL, never DATABASE_URL."""
import os
import unittest
import uuid
from threading import Event
from unittest.mock import patch

from sqlalchemy import create_engine, text, event
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError

from src.db.models import Base, LogicalDocument, LogicalSection, LogicalBlock, LogicalImage, LogicalTextPosition
from src.db.session import database_budget
from src.mcp_server import db_helpers
from src.mcp_server.section_search import search_section_evidence
import time


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "isolated test database not configured")
class PostgresIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(os.environ["TEST_DATABASE_URL"])
        cls.schema = "test_logical_" + uuid.uuid4().hex
        with cls.engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_search"))
            connection.execute(text(f'CREATE SCHEMA "{cls.schema}"'))
        cls.addClassCleanup(cls.cleanup_schema)
        cls.scoped = cls.engine.execution_options(schema_translate_map={None: cls.schema})
        Base.metadata.create_all(cls.scoped)
        with cls.engine.begin() as connection:
            connection.execute(text(f'SET LOCAL search_path TO "{cls.schema}", public'))
            connection.execute(text("CREATE INDEX test_blocks_bm25 ON logical_blocks USING bm25 (id, content) WITH (key_field='id')"))
        cls.vector = [1.0] + [0.0] * (db_helpers.LogicalBlock.embedding.type.dim - 1)
        with Session(cls.scoped) as session:
            session.add_all([LogicalDocument(id=d, user_id="test", file_name=d + ".pdf",
                workspace_id=w, total_pages=1, fts_config="simple")
                for d, w in [("a", "ws"), ("b", "ws"), ("outside", "other")]])
            session.flush()
            session.add_all([LogicalSection(id=i, document_id=d, workspace_id=w,
                section_id="sec_1", title="Evidence")
                for i, d, w in [(101, "a", "ws"), (202, "b", "ws"), (303, "outside", "other")]])
            session.add_all([LogicalBlock(id=i, document_id=d, workspace_id=w,
                section_id="sec_1", block_type="text", content="needle evidence",
                page_number=1, embedding=cls.vector)
                for i, d, w in [(1, "a", "ws"), (2, "b", "ws"), (3, "outside", "other")]])
            session.add_all([LogicalBlock(id=i, document_id="a", workspace_id="ws",
                section_id="sec_1", block_type="text", content="appendix", page_number=1)
                for i in (4, 5)])
            session.add(LogicalImage(id="image-a", document_id="a", section_id="sec_1",
                content="chart", image_base64="", page_number=1))
            session.commit()

    @classmethod
    def cleanup_schema(cls):
        with cls.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{cls.schema}" CASCADE'))
        cls.engine.dispose()

    def test_context_load_budget_streams_real_sql_and_closes_on_overflow(self):
        with Session(self.scoped) as session:
            session.execute(text(f'SET LOCAL search_path TO "{self.schema}", public'))
            doc = session.get(LogicalDocument, "a")
            section = session.get(LogicalSection, 101)
            result = db_helpers._section_content_batch(session, doc, "a", [section], max_bytes=4096)
            self.assertEqual([block["block_id"] for block in result[101]["blocks"]], [1, 4, 5])
            self.assertEqual(result[101]["images"][0]["content"], "chart")
            session.get(LogicalBlock, 1).content = "\u00e9" * 4096
            session.flush()
            with self.assertRaises(db_helpers.ContextContentLimitError):
                db_helpers._section_content_batch(session, doc, "a", [section], max_bytes=1024)
            self.assertEqual(session.execute(text("SELECT 1")).scalar(), 1)

    def test_real_vector_and_bm25_channels_respect_exact_section_scope(self):
        with Session(self.scoped) as session:
            result = db_helpers.search_blocks_hybrid(session, "needle", self.vector,
                workspace_id="ws", section_id="101", include_section_context=False)
            self.assertEqual([item["block_id"] for item in result], [1])
            self.assertIsNotNone(result[0]["retrieval_scores"]["vector"])
            self.assertIsNotNone(result[0]["retrieval_scores"]["bm25"])
            self.assertEqual(db_helpers.search_blocks_hybrid(session, "needle", self.vector,
                workspace_id="ws", section_id="303", include_section_context=False), [])

    def test_citations_keep_document_identity_and_reject_unsupported_evidence(self):
        with Session(self.scoped) as session:
            for block_id, doc_id, content in [(1, "a", "The limit is 10."),
                                               (2, "b", "The limit is 999.")]:
                block = session.get(LogicalBlock, block_id)
                block.block_id = "p1_b1"
                block.content = content
                session.get(LogicalDocument, doc_id).source = doc_id + ".pdf"
                session.add(LogicalTextPosition(document_id=doc_id, section_id="sec_1",
                    block_id="p1_b1", page_number=1,
                    words=[{"text": word, "bbox": [0, 0, 1, 1]} for word in content.split()]))
            session.flush()
            for locate in (db_helpers.locate_answer_citation_positions,
                           db_helpers.locate_answer_citation_positions_mistral):
                with self.subTest(locator=locate.__name__):
                    result = locate(session, [
                        {"type": "text", "block_id": "1", "reference": 1,
                         "evidence_text": "The limit is 999."},
                        {"type": "text", "block_id": "1", "reference": 2,
                         "evidence_text": "The limit is 10."},
                        {"type": "text", "block_id": "p1_b1", "reference": 3,
                         "evidence_text": "The limit is 999."},
                    ], None, "ws")
                    self.assertEqual(len(result["citations"]), 1)
                    self.assertEqual(result["citations"][0]["reference"], "[2]")
                    self.assertEqual(result["citations"][0]["source"], "a.pdf")
                    self.assertEqual(locate(session, [{"type": "text", "block_id": "1",
                        "reference": 1, "evidence_text": "The limit is 10."}],
                        None, "other"), {"citations": []})

    def test_batch_reader_uses_three_queries_and_preserves_duplicate_associations(self):
        statements = []
        def capture(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)
        with Session(self.scoped) as session:
            event.listen(self.engine, "before_cursor_execute", capture)
            try:
                result = db_helpers.read_sections_with_blocks(session, ["202", "101", "202", "303"], "ws")
            finally:
                event.remove(self.engine, "before_cursor_execute", capture)
        self.assertEqual(len(statements), 3)
        self.assertEqual([r["section_id"] if r else None for r in result], [202, 101, 202, None])
        self.assertEqual(result[0]["blocks"][0]["block_id"], 2)
        self.assertEqual(result[1]["images"][0]["image_id"], "image-a")
        self.assertIs(result[0], result[2])

    def test_remaining_deadline_cancels_real_sql(self):
        with Session(self.scoped) as session:
            with self.assertRaises(DBAPIError):
                with database_budget(session, time.monotonic() + 0.1, Event()):
                    session.execute(text("SELECT pg_sleep(2)"))
            session.rollback()
            self.assertEqual(session.execute(text("SELECT 1")).scalar_one(), 1)

    def test_batch_window_limit_is_per_section_and_continuation_has_no_gaps(self):
        with Session(self.scoped) as session, patch.object(db_helpers.settings, "READ_BLOCK_PAGE_SIZE", 1):
            first = db_helpers.read_sections_with_blocks(session, ["101", "202"], "ws")
            self.assertEqual([item["blocks"][0]["block_id"] for item in first], [1, 2])
            self.assertTrue(first[0]["truncated"])
            self.assertFalse(first[1]["truncated"])
            self.assertNotIn("required_next_tool_call", first[1])
            collected = [1]
            item = first[0]
            while item["truncated"]:
                args = item["required_next_tool_call"]["arguments"]
                item = db_helpers.read_sections_with_blocks(session, ["101"], "ws",
                    block_offset=args["block_offset"], image_offset=args["image_offset"])[0]
                collected.extend(block["block_id"] for block in item["blocks"])
            self.assertEqual(collected, [1, 4, 5])
            self.assertNotIn("required_next_tool_call", item)
            self.assertFalse(item["retrieval_complete"])

    def test_partition_pruning_with_workspace_predicate(self):
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TEMP TABLE pruning_fixture (id int, workspace_id text) PARTITION BY LIST (workspace_id)"))
            connection.execute(text("CREATE TEMP TABLE pruning_ws PARTITION OF pruning_fixture FOR VALUES IN ('ws')"))
            connection.execute(text("CREATE TEMP TABLE pruning_other PARTITION OF pruning_fixture FOR VALUES IN ('other')"))
            plan = connection.execute(text("EXPLAIN (FORMAT JSON) SELECT id FROM pruning_fixture WHERE workspace_id='ws'")).scalar_one()
            self.assertIn("pruning_ws", str(plan))
            self.assertNotIn("pruning_other", str(plan))

    def test_section_evidence_handles_inherited_subject_and_image_deduplication(self):
        with Session(self.scoped) as session:
            session.add(LogicalSection(id=404, document_id="a", workspace_id="ws",
                section_id="cancellation", title="Cancellation policy"))
            session.flush()
            session.add_all([
                LogicalBlock(id=40, document_id="a", workspace_id="ws", section_id="cancellation",
                    block_type="text", content="A fee of 25 euros applies.", page_number=1),
                LogicalBlock(id=41, document_id="a", workspace_id="ws", section_id="cancellation",
                    block_type="text", content="Except during the first fourteen days.", page_number=1),
                LogicalBlock(id=42, document_id="a", workspace_id="ws", section_id="cancellation",
                    block_type="image/chart", content="Fees chart", page_number=2, bbox=[1, 2, 3, 4]),
                LogicalImage(id="linked", document_id="a", section_id="cancellation", content="Fees chart",
                    page_number=2, bbox=[1, 2, 3, 4], image_base64="must not load"),
                LogicalImage(id="unmatched", document_id="a", section_id="cancellation", content="Refund chart",
                    page_number=3, image_base64="must not load"),
            ])
            session.flush()
            results = search_section_evidence(session, ["404", "303"], "ws",
                "cancellation fee", top_k=5, include_neighbors=True)
            entries = results[0]["blocks"]
            self.assertEqual({entry.get("block_id") for entry in entries}, {40, 41, 42, None})
            self.assertEqual(sum(entry.get("image_id") == "linked" for entry in entries), 1)
            self.assertEqual(sum(entry.get("image_id") == "unmatched" for entry in entries), 1)
            self.assertNotIn("image_base64", str(results))
            self.assertEqual(results[1]["error"], "Section not found")
            self.assertFalse(results[0]["has_more_blocks"])
            # A title-only query must still return details that omit the subject.
            title_only = search_section_evidence(session, ["404"], "ws", "cancellation", top_k=1)
            self.assertEqual(title_only[0]["blocks"][0]["block_id"], 40)
            self.assertTrue(title_only[0]["has_more_blocks"])
            # No commit: fixtures are rolled back when this session closes.

    def test_section_evidence_vector_and_neighbor_queries_stay_inside_section(self):
        with Session(self.scoped) as session:
            results = search_section_evidence(session, ["101", "202", "303"], "ws",
                "needle", self.vector, top_k=1, include_neighbors=True)
            self.assertEqual([b["block_id"] for b in results[0]["blocks"]], [1, 4])
            self.assertEqual([b["block_id"] for b in results[1]["blocks"]], [2])
            self.assertEqual(results[2]["error"], "Section not found")
            self.assertGreater(results[0]["blocks"][0]["score"], 0)

    def test_section_evidence_returns_image_only_section(self):
        with Session(self.scoped) as session:
            session.add(LogicalSection(id=405, document_id="a", workspace_id="ws",
                section_id="visual", title="Revenue", embedding=self.vector))
            session.flush()
            session.add(LogicalImage(id="only-image", document_id="a", section_id="visual",
                content="Revenue rose by 20 percent.", image_base64="", page_number=1))
            session.flush()
            result = search_section_evidence(session, ["405"], "ws", "revenue growth")
            self.assertEqual(result[0]["blocks"][0]["image_id"], "only-image")
            self.assertNotIn("block_id", result[0]["blocks"][0])
            global_hits = db_helpers.unified_search(session, "revenue", self.vector,
                workspace_id="ws", file_name="a.pdf", include_lexical=False, limit=10)
            self.assertIn(405, [hit["section_id"] for hit in global_hits])
            self.assertNotIn(405, [hit["section_id"] for hit in db_helpers.unified_search(
                session, "revenue", self.vector, workspace_id="other", include_lexical=False)])

    def test_visual_vectors_discover_and_deliver_linked_and_descriptionless_images(self):
        with Session(self.scoped) as session:
            session.add(LogicalDocument(id="visual-test", user_id="test", file_name="visual.pdf",
                workspace_id="visual-ws", total_pages=2, fts_config="simple"))
            session.flush()
            session.add_all([LogicalSection(id=i, document_id="visual-test", workspace_id="visual-ws",
                section_id=str(i), title="Figure") for i in (450, 451)])
            session.flush()
            session.add(LogicalBlock(id=450, document_id="visual-test", workspace_id="visual-ws",
                section_id="450", block_type="image", content="Three services connected.",
                page_number=1, bbox=[1, 2, 3, 4], embedding=[-v for v in self.vector]))
            session.add_all([
                LogicalImage(id="visual-linked", document_id="visual-test", section_id="450",
                    page_number=1, bbox=[1, 2, 3, 4], image_base64="", embedding=self.vector),
                LogicalImage(id="visual-only", document_id="visual-test", section_id="451",
                    page_number=2, image_base64="", embedding=self.vector),
                LogicalImage(id="visual-outside", document_id="outside", section_id="sec_1",
                    page_number=1, image_base64="", embedding=self.vector),
            ])
            session.flush()
            hits = db_helpers.unified_search(session, "services", self.vector,
                workspace_id="visual-ws", include_lexical=False)
            self.assertEqual({hit["section_id"] for hit in hits}, {450, 451})
            self.assertTrue(all(hit["matched_image"] for hit in hits))
            evidence = search_section_evidence(session, [450, 451, 303], "visual-ws", "services",
                self.vector, top_k=1, preferred_images={450: "visual-linked", 451: "visual-only"})
            linked = evidence[0]["blocks"]
            self.assertEqual(len(linked), 1)
            self.assertEqual(linked[0]["block_id"], 450)
            self.assertEqual(linked[0]["image_id"], "visual-linked")
            self.assertEqual(linked[0]["content"], "Three services connected.")
            self.assertEqual(evidence[1]["blocks"][0]["image_id"], "visual-only")
            self.assertNotIn("block_id", evidence[1]["blocks"][0])
            self.assertEqual(evidence[2]["error"], "Section not found")
            excluded = db_helpers.unified_search(session, "services", self.vector,
                workspace_id="visual-ws", document_id="visual-test", include_lexical=False,
                exclude_section_ids=[450])
            self.assertEqual([hit["section_id"] for hit in excluded], [451])

    def test_cached_hydration_returns_identical_evidence_and_aliases(self):
        with Session(self.scoped) as session:
            baseline = search_section_evidence(session, [101], "ws", "needle", self.vector,
                                               top_k=2, include_neighbors=True)
            cache = {}
            db_helpers._get_block_contents_by_internal_ids(session, [1], version_cache=cache)
            cached = search_section_evidence(session, [101], "ws", "needle", self.vector,
                top_k=2, include_neighbors=True, block_content_cache=cache)
            self.assertEqual(baseline, cached)
            stale = {1: ("stale evidence", "0")}
            refreshed = search_section_evidence(session, [101], "ws", "needle", self.vector,
                top_k=2, include_neighbors=True, block_content_cache=stale)
            self.assertEqual(baseline, refreshed)

    def test_single_document_is_not_restricted_by_diversity_quota(self):
        with Session(self.scoped) as session:
            for i in range(410, 414):
                session.add(LogicalSection(id=i, document_id="a", workspace_id="ws",
                    section_id=str(i), title="Policy", embedding=self.vector))
            session.flush()
            for i in range(410, 414):
                session.add(LogicalBlock(id=i, document_id="a", workspace_id="ws",
                    section_id=str(i), block_type="text", content="Policy details", page_number=1))
            session.flush()
            single = db_helpers.unified_search(session, "policy", self.vector,
                workspace_id="ws", file_name="a.pdf", include_lexical=False,
                limit=10, per_document_limit=1)
            self.assertTrue(set(range(410, 414)).issubset(h["section_id"] for h in single))
            multiple = db_helpers.unified_search(session, "policy", self.vector,
                workspace_id="ws", include_lexical=False, limit=10, per_document_limit=1)
            self.assertEqual(len({h["document_id"] for h in multiple}), len(multiple))

    def test_concurrent_source_update_invalidates_cached_text(self):
        with Session(self.scoped) as writer:
            writer.add(LogicalDocument(id="freshness", workspace_id="freshness", user_id="test",
                file_name="freshness.pdf", total_pages=1, fts_config="simple"))
            writer.flush()
            writer.add(LogicalSection(id=900, document_id="freshness", workspace_id="freshness",
                                     section_id="fresh", title="Policy"))
            writer.flush()
            writer.add(LogicalBlock(id=900, document_id="freshness", workspace_id="freshness",
                section_id="fresh", block_type="text", content="Old policy.", page_number=1))
            writer.commit()
        with Session(self.scoped) as reader:
            cache = {}
            db_helpers._get_block_contents_by_internal_ids(reader, [900], version_cache=cache)
            with Session(self.scoped) as writer:
                writer.get(LogicalBlock, 900).content = "New exceptions apply."
                writer.commit()
            result = search_section_evidence(reader, [900], "freshness", "policy",
                                             block_content_cache=cache)
            self.assertEqual(result[0]["blocks"][0]["content"], "New exceptions apply.")

    def test_oversized_image_columns_are_bounded_in_postgresql(self):
        with Session(self.scoped) as session:
            session.add_all([
                LogicalImage(id="too-large", document_id="a", section_id="bounded-images",
                             image_base64="A" * 201, content="B" * 201, page_number=1),
                LogicalImage(id="normal", document_id="a", section_id="bounded-images",
                             image_base64="stored-payload", content="Description", page_number=1),
            ])
            session.commit()
            with patch.object(db_helpers.settings, "IMAGE_MAX_ENCODED_BYTES", 100):
                images = {image.id: image for image in db_helpers._get_section_image_records(
                    session, "a", "bounded-images")}
                self.assertEqual(images["too-large"].image_base64, "")
                self.assertEqual(images["too-large"].content, "")
                self.assertEqual(images["normal"].image_base64, "stored-payload")
                self.assertEqual(images["normal"].content, "Description")
                full = db_helpers.read_full_document_content(session, document_id="a", workspace_id="ws")
                self.assertIsNotNone(full)

    def test_neighboring_exception_survives_primary_selection(self):
        with Session(self.scoped) as session:
            session.add(LogicalSection(id=406, document_id="a", workspace_id="ws",
                                       section_id="exceptions", title="Approval"))
            session.flush()
            session.add_all([
                LogicalBlock(id=60, document_id="a", workspace_id="ws", section_id="exceptions",
                    block_type="text", content="Except in emergencies.", page_number=1),
                LogicalBlock(id=61, document_id="a", workspace_id="ws", section_id="exceptions",
                    block_type="text", content="Approval is required.", page_number=1, embedding=self.vector),
            ])
            session.flush()
            result = search_section_evidence(session, [406], "ws", "approval", self.vector,
                                             top_k=1, include_neighbors=True)
            self.assertEqual([b["block_id"] for b in result[0]["blocks"]], [60, 61])
            self.assertEqual(result[0]["blocks"][0]["selection"], "adjacent")

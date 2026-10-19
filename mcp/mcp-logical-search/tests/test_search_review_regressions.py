"""Correctness boundaries for the token/latency optimizations."""
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from sqlalchemy.dialects import postgresql

from src.mcp_server import db_helpers, context_navigation
from src.mcp_server.evidence import group_evidence, serialized_bytes
from src.mcp_server.section_search import search_section_evidence


def fixture_sections(count=10):
    return [{"section_id": n, "document_id": "d", "workspace_id": "ws",
             "file_name": "policy.pdf", "has_more_blocks": False,
             "blocks": [{"block_id": n * 100 + b, "content": "x" * 1000,
                         **({"selection": "adjacent"} if b != 4 else {"score": .8})}
                        for b in range(9)]} for n in range(count)]


class PackingRegressionTests(unittest.TestCase):
    def test_ten_sections_receive_primary_before_neighbors(self):
        sections = fixture_sections()
        original = copy.deepcopy(sections)
        result = group_evidence(sections, 24000)
        delivered = result["documents"][0]["sections"]
        self.assertEqual(len(delivered), 10)
        for section in delivered:
            self.assertIn(section["section_id"] * 100 + 4,
                          [block["block_id"] for block in section["blocks"]])
            self.assertEqual([b["block_id"] for b in section["blocks"]],
                             sorted(b["block_id"] for b in section["blocks"]))
        self.assertLessEqual(serialized_bytes(result), 24000)
        self.assertTrue(result["budget_exhausted"])
        self.assertEqual(sections, original)

    def test_exception_is_preserved_or_explicitly_omitted(self):
        section = {"section_id": 1, "has_more_blocks": False, "blocks": [
            {"block_id": 1, "selection": "adjacent", "content": "Except for emergencies. " * 30},
            {"block_id": 2, "score": .8, "content": "Approval is required."}]}
        for budget in (400, 2000):
            result = group_evidence([section], budget)
            delivered = result["documents"][0]["sections"][0]
            self.assertIn(2, [b["block_id"] for b in delivered["blocks"]])
            if budget == 400:
                self.assertTrue(delivered["has_more_blocks"])
                self.assertTrue(result["budget_exhausted"])
            else:
                self.assertEqual(delivered["blocks"], section["blocks"])
                self.assertFalse(delivered["has_more_blocks"])

    def test_preferred_rank_wins_over_score_without_leaking_internal_metadata(self):
        result = group_evidence([{"section_id": 1, "blocks": [
            {"block_id": 1, "score": .99, "_selection_rank": 2, "content": "a" * 200},
            {"block_id": 2, "score": .01, "_selection_rank": 1, "content": "b" * 200},
        ]}], 450)
        blocks = result["documents"][0]["sections"][0]["blocks"]
        self.assertEqual([b["block_id"] for b in blocks], [2])
        self.assertNotIn("_selection_rank", str(result))

    def test_unicode_escaping_and_metadata_overflow_are_bounded(self):
        sections = fixture_sections()
        for section in sections:
            section["title"] = '\u4f8b\u5916"\\\n' * 30
            section["children"] = [{"section_id": i, "title": '\u20ac"\\' * 20} for i in range(10)]
        for budget in (200, 500, 1200, 24000):
            result = group_evidence(sections, budget)
            self.assertLessEqual(serialized_bytes(result), budget)
            self.assertTrue(result["budget_exhausted"])


class ReadReuseRegressionTests(unittest.TestCase):
    def test_hydration_reuses_text_but_still_fetches_scoped_metadata(self):
        metadata = SimpleNamespace(section_id=42, _mapping={"section_id": 42,
            "local_id": "local", "title": "Policy", "document_id": "d",
            "workspace_id": "ws", "file_name": "a.pdf"})
        winner = SimpleNamespace(section_id=42, total_count=1, block_id=7,
                                 image_id=None, score=.2, position=1)
        block = SimpleNamespace(id=7, content=None, block_type="text", page_number=1, image_id=None,
                                content_reused=True)
        session = Mock()
        session.execute.return_value.all.side_effect = [[metadata], [winner], [block]]
        result = search_section_evidence(session, [42], "ws", "fee",
                                         block_content_cache={7: ("Exact cached source.", "123")})
        self.assertEqual(result[0]["blocks"][0]["content"], "Exact cached source.")
        sql = str(session.execute.call_args_list[2].args[0].compile(dialect=postgresql.dialect()))
        self.assertIn("CASE WHEN", sql)
        self.assertIn("logical_blocks.xmin", sql)
        self.assertIn("logical_blocks.workspace_id IN", sql)
        self.assertIn("logical_blocks.document_id IN", sql)

    def test_overlapping_roots_reuse_reads_without_suppressing_context(self):
        nodes = [{"id": i, "section_id": "s" + str(i), "title": str(i),
                  "parent_section_id": 1 if i != 1 else None} for i in (1, 2, 3)]
        def resolve(session, ref, doc_ids):
            return (SimpleNamespace(id=int(ref)), "d") if "d" in doc_ids else None
        def sections(session, doc, ids):
            return [SimpleNamespace(id=i) for i in ids]
        def payloads(session, doc, doc_id, selected, **kwargs):
            return {s.id: {"blocks": [{"block_id": s.id, "content": "source " + str(s.id)}]}
                    for s in selected}
        with patch.object(db_helpers, "_resolve_section", side_effect=resolve), patch.object(
            db_helpers, "get_document_by_internal_id", return_value=None), patch.object(
            context_navigation, "load_hierarchy", side_effect=lambda *a: context_navigation.Hierarchy(nodes)) as load, patch.object(
            db_helpers, "_get_sections_by_ids", side_effect=sections), patch.object(
            db_helpers, "_section_content_batch", side_effect=payloads) as hydrate:
            cache = {}
            child = db_helpers.expand_section_context(None, "2", ["d"], batch_cache=cache)
            parent = db_helpers.expand_section_context(None, "1", ["d"], batch_cache=cache)
            self.assertEqual(load.call_count, 1)
            self.assertEqual([[s.id for s in c.args[3]] for c in hydrate.call_args_list], [[1, 2], [3]])
            for i in (1, 2):
                self.assertIn("source " + str(i), child["content"])
                self.assertIn("source " + str(i), parent["content"])
            self.assertIn("source 3", parent["content"])
            # Even an existing cache cannot resolve an unauthorized root.
            self.assertIsNone(db_helpers.expand_section_context(None, "1", [], batch_cache=cache))
            fresh = db_helpers.expand_section_context(None, "1", ["d"])
            self.assertEqual(parent, fresh)
            self.assertEqual(load.call_count, 2)

    def test_pagination_never_serializes_unbounded_suffix(self):
        result = {"target_section_id": 1, "workspace_id": "ws", "content": '\u4f8b"\\\n' * 100000}
        original = context_navigation.serialized_bytes
        lengths = []
        def measure(value):
            lengths.append(len(value.get("content", "")))
            return original(value)
        with patch.object(context_navigation, "serialized_bytes", side_effect=measure):
            page = context_navigation.paginate_context(result, 0, 1024)
        self.assertLessEqual(max(lengths), 1024)
        self.assertGreater(page["next_content_offset"], 0)
        self.assertEqual(page["content"], result["content"][:page["next_content_offset"]])

    def test_image_only_resolution_checks_document_and_section_identity(self):
        session = Mock()
        session.execute.return_value.all.return_value = [("d", "visual", 42, "Chart")]
        result = db_helpers._resolve_section_metadata(session, [("d", "visual")])
        sql = str(session.execute.call_args.args[0].compile(dialect=postgresql.dialect()))
        self.assertIn("logical_images.document_id = logical_sections.document_id", sql)
        self.assertIn("logical_images.section_id = logical_sections.section_id", sql)
        self.assertIn(" OR ", sql)
        self.assertEqual(result[("d", "visual")][0], 42)

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy.dialects import postgresql

from src.mcp_server.evidence import excerpt, group_evidence, serialized_bytes
from src.mcp_server.section_search import search_section_evidence
from src.mcp_server import db_helpers
import src.mcp_server.logical_indexing_server as server


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        filename_patch = patch.object(server, "_prepare_filename_semantic_scores", AsyncMock(return_value={}))
        filename_patch.start()
        self.addCleanup(filename_patch.stop)

    def test_excerpt_finds_late_evidence_and_preserves_exact_source(self):
        content = "Introduction. " * 200 + "Cancellation fee is 25 euros. Exceptions apply. " * 5
        result = excerpt(content, "cancellation fee exceptions", 160)
        self.assertIn("Cancellation fee", result["content"])
        self.assertEqual(result["content"], content[result["content_offset"]:result["content_offset"] + 160])
        self.assertTrue(result["content_truncated"])
        self.assertEqual(result["content_length"], len(content))

    def test_short_content_is_complete_and_empty_query_starts_at_zero(self):
        self.assertEqual(excerpt("€25", "fees"), {"content": "€25", "content_truncated": False})
        self.assertEqual(excerpt("abc" * 100, "", 20)["content_offset"], 0)

    def test_budget_includes_unicode_metadata_and_all_sections(self):
        sections = [{"section_id": n, "file_name": "合同.pdf", "workspace_id": "ws",
                     "title": "条款", "score": .8, "blocks": [
                         {"block_id": n, **excerpt("例外" * 500)}], "has_more_blocks": False}
                    for n in range(10)]
        result = group_evidence(sections, 1400)
        self.assertLessEqual(serialized_bytes(result), 1400)
        self.assertTrue(result["budget_exhausted"])
        self.assertEqual(len(result["documents"]), 1)
        self.assertTrue(any(s["has_more_blocks"] for s in result["documents"][0]["sections"]))

    def test_grouping_keeps_workspaces_separate_and_global_rank(self):
        sections = [{"section_id": n, "workspace_id": ws, "file_name": "same.pdf", "blocks": []}
                    for n, ws in [(1, "a"), (2, "b"), (3, "a")]]
        result = group_evidence(sections, 4000)
        self.assertEqual(len(result["documents"]), 2)
        self.assertEqual([s["rank"] for s in result["documents"][0]["sections"]], [1, 3])

    def test_default_search_uses_evidence_without_mandatory_section_read(self):
        match = {"section_id": 1, "score": .7, "section_title": "Cancellation",
                 "file_name": "contract.pdf", "matched_block": {"block_id": 2, "content": "€25 applies."}}
        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))), patch.object(
            server, "_run_unified_search", AsyncMock(return_value=[match])) as search:
            result = asyncio.run(server.search.fn.__wrapped__(query="fee", workspace_id="ws"))
        section = result["documents"][0]["sections"][0]
        self.assertEqual(section["blocks"][0]["content"], "€25 applies.")
        self.assertEqual(section["score"], .7)
        self.assertNotIn("required_next_tool_call", section)
        self.assertNotIn("preview", section)
        self.assertTrue(search.call_args.kwargs["include_evidence"])

    def test_tool_is_registered_and_exposes_navigation_arguments(self):
        tools = asyncio.run(server.mcp.get_tools())
        self.assertIn("search_in_sections", tools)
        parameters = server.search_in_sections.parameters["properties"]
        self.assertNotIn("file_name", parameters)
        self.assertEqual(parameters["top_k"]["maximum"], 10)
        self.assertTrue(parameters["include_neighbors"]["default"])

    def test_single_search_response_obeys_evidence_budget(self):
        matches = [{"section_id": n, "section_title": "Policy", "file_name": "same.pdf",
                    "score": .8, "matched_block": {"block_id": n, "content": "例外 " * 200}}
                   for n in (1, 2, 3, 4)]
        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))), patch.object(
            server, "_run_unified_search", AsyncMock(return_value=matches)), patch.object(
            server.settings, "SEARCH_EVIDENCE_MAX_BYTES", 1400):
            result = asyncio.run(server.search.fn.__wrapped__(
                query="fee", workspace_id="ws", top_k=4))
        self.assertLessEqual(serialized_bytes(result), 1400)
        self.assertTrue(result["budget_exhausted"])


    def test_coverage_metadata_and_block_batches_obey_total_budget(self):
        with patch.object(server.settings, "SEARCH_EVIDENCE_MAX_BYTES", 1200):
            response = server._coverage_evidence_response({
                "behavior": "coverage", "evaluated_documents": [], "no_hit_documents": [],
                "not_evaluated_documents": [{"document_id": "long" * 500, "workspace_id": "ws"}] * 10,
            }, [], "fee")
        self.assertLessEqual(serialized_bytes(response), 1200)
        self.assertEqual(response["not_evaluated_documents_omitted"], 10)
        self.assertTrue(response["budget_exhausted"])

        async def run(operation, deadline):
            return operation(object())
        with patch.object(server, "_require_search_scope"), patch.object(server, "_run_reader_db", side_effect=run), patch.object(
            server, "_resolve_document_id", return_value=["doc"]), patch.object(
            server, "read_blocks_by_ids", return_value=[{"block_id": n, "content": "例外" * 1000} for n in range(30)]), patch.object(
            server.settings, "SEARCH_EVIDENCE_MAX_BYTES", 1200):
            result = asyncio.run(server.read_blocks.fn.__wrapped__(block_id=[str(n) for n in range(30)], workspace_id="ws"))
        self.assertLessEqual(serialized_bytes(result), 1200)
        self.assertEqual(result[-1]["status"], "remaining_not_evaluated")

    def test_navigation_only_context_does_not_load_section_content(self):
        from src.mcp_server.context_navigation import Hierarchy
        hierarchy = Hierarchy([
            {"id": 41, "section_id": "parent", "title": "Parent"},
            {"id": 42, "section_id": "local", "title": "Policy", "parent_section_id": "41"},
        ])
        section = SimpleNamespace(id=42, section_id="local", title="Policy")
        with patch.object(db_helpers, "_resolve_section", return_value=(section, "doc")), patch.object(
            db_helpers, "get_document_by_internal_id", return_value=None), patch(
            "src.mcp_server.context_navigation.load_hierarchy", return_value=hierarchy), patch.object(
            db_helpers, "_section_content_batch") as load:
            result = db_helpers.expand_section_context(object(), "42", ["doc"], include_content=False)
        load.assert_not_called()
        self.assertEqual(result["sections"], [{"section_id": 41, "title": "Parent"},
                                              {"section_id": 42, "title": "Policy"}])
        self.assertFalse(result["context_complete"])
        self.assertEqual(result["stop_reason"], "navigation_only")

    def test_new_tool_checks_authorization_before_embedding_or_database(self):
        with patch.object(server, "_get_effective_workspace_ids", return_value=["allowed"]), patch.object(
            server, "get_query_embedding") as embed, patch.object(server, "_run_db") as run:
            with self.assertRaises(server.AuthorizationScopeError):
                asyncio.run(server.search_in_sections.fn.__wrapped__(
                    query="fee", section_id="42", workspace_id="outside"))
        embed.assert_not_called()
        run.assert_not_called()

    def test_new_tool_rejects_bad_ids_and_limits(self):
        for ids, top_k in [("sec_42", 3), ([str(n) for n in range(11)], 3), ("42", 0)]:
            with self.subTest(ids=ids), patch.object(server, "_run_db") as run:
                result = asyncio.run(server.search_in_sections.fn.__wrapped__(
                    query="fee", section_id=ids, workspace_id="ws", top_k=top_k))
                self.assertIn("error", result)
                run.assert_not_called()

    def test_new_tool_works_without_embedding_provider(self):
        async def run(operation, deadline):
            return operation(object())
        with patch.object(server, "_require_search_scope"), patch.object(
            server.settings, "LITELLM_BASE_URL", None), patch.object(server, "_run_db", side_effect=run), patch.object(
            server, "search_section_evidence", return_value=[{"section_id": 42, "blocks": [], "title": "Policy"}]) as helper:
            result = asyncio.run(server.search_in_sections.fn.__wrapped__(
                query="fee", section_id=["42"], workspace_id="ws"))
        self.assertIsNone(helper.call_args.args[4])
        self.assertTrue(helper.call_args.kwargs["include_neighbors"])
        self.assertEqual(result["documents"][0]["sections"][0]["section_id"], 42)

    def test_query_aware_section_read_can_skip_image_bytes(self):
        text = "Intro " * 300 + "Cancellation costs 25 euros."
        section = SimpleNamespace(id=42, section_id="local", title="Policy")
        doc = SimpleNamespace(id="doc-1", source=None, workspace_id="ws", file_name="a.pdf", user_id="u")
        block = SimpleNamespace(id=1, content=text, block_type="image/chart", page_number=1, bbox=[1, 2, 3, 4])
        image = SimpleNamespace(id="im", content=text, page_number=1, bbox=[1, 2, 3, 4])
        result = db_helpers._format_section_read(section, doc, [block], [image], True, 0, 0,
                                                query="cancellation costs", include_images=False)
        self.assertIn("Cancellation costs", result["blocks"][0]["content"])
        self.assertEqual(result["blocks"][0]["image_id"], "im")
        self.assertNotIn("image_base64", result["blocks"][0])
        self.assertEqual(result["images"], [])

    def test_scoped_sql_ranks_images_and_blocks_without_loading_binary_payloads(self):
        row = SimpleNamespace(section_id=42, _mapping={"section_id": 42, "local_id": "local",
            "title": "Cancellation", "document_id": "doc", "file_name": "a.pdf", "workspace_id": "ws"})
        session = Mock()
        session.execute.return_value.all.side_effect = [[row], []]
        result = search_section_evidence(session, ["42"], "ws", "fee")
        sql = str(session.execute.call_args_list[1].args[0].compile(dialect=postgresql.dialect()))
        self.assertIn("UNION ALL", sql)
        self.assertIn("logical_blocks.workspace_id = evidence_scope.workspace_id", sql)
        self.assertIn("NOT (EXISTS", sql)
        self.assertNotIn("image_base64", sql)
        self.assertIn("evidence_scope.title", sql)
        self.assertEqual(result[0]["blocks"], [])

    def test_read_blocks_continuation_reconstructs_unicode_content(self):
        content = "例外 \\\" € " * 1000
        async def run(operation, deadline):
            return operation(object())
        offset, parts = 0, []
        with patch.object(server, "_require_search_scope"), patch.object(server, "_run_reader_db", side_effect=run), patch.object(
            server, "_resolve_document_id", return_value=["doc"]), patch.object(
            server, "read_blocks_by_ids", return_value=[{"block_id": 1, "content": content}]), patch.object(
            server.settings, "SEARCH_EVIDENCE_MAX_BYTES", 1200):
            for _ in range(100):
                result = asyncio.run(server.read_blocks.fn.__wrapped__(
                    block_id="1", workspace_id="ws", content_offset=offset))[0]
                self.assertLessEqual(serialized_bytes(result), 1200)
                parts.append(result["content"])
                if "next_content_offset" not in result:
                    break
                self.assertGreater(result["next_content_offset"], offset)
                offset = result["next_content_offset"]
        self.assertEqual("".join(parts), content)


if __name__ == "__main__":
    unittest.main()

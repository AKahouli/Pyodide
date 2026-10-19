import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from src.mcp_server.context_navigation import Hierarchy, attach_search_ancestors
from src.mcp_server.evidence import serialized_bytes
import src.mcp_server.logical_indexing_server as server


def hierarchy():
    return Hierarchy([
        {"id": 1, "section_id": "root", "title": "Policy", "parent_section_id": None},
        {"id": 2, "section_id": "scope", "title": "Approval", "parent_section_id": "1"},
        {"id": 3, "section_id": "child", "title": "Requirements", "parent_section_id": "2"},
        {"id": 4, "section_id": "grandchild", "title": "Exceptions", "parent_section_id": "3"},
        {"id": 5, "section_id": "unrelated", "title": "Reporting", "parent_section_id": "1"},
    ])


class SearchNavigationTests(unittest.TestCase):
    def test_single_toggle_controls_both_navigation_lists(self):
        for enabled in (False, True):
            with self.subTest(enabled=enabled):
                hits = [{"document_id": "doc", "section_id": 2, "file_name": "policy.pdf", "ancestors": ["stale"]}]
                with patch("src.mcp_server.context_navigation.load_hierarchy", return_value=hierarchy()) as load:
                    attach_search_ancestors(Mock(), hits, include_hierarchy=enabled)
                self.assertEqual(load.call_count, int(enabled))
                evidence = server._search_evidence_response(hits, "approval")["documents"][0]["sections"][0]
                legacy = server._compact_search_results(hits, 5, "ws")[0]
                for response in (evidence, legacy):
                    self.assertEqual("ancestors" in response, enabled)
                    self.assertEqual("descendants" in response, enabled)
                    self.assertNotIn("children", response)
                    if enabled:
                        self.assertEqual(response["ancestors"], [{"section_id": 1, "title": "Policy"}])
                        self.assertEqual([r["section_id"] for r in response["descendants"]], [3, 4])
                        self.assertEqual(response["descendant_count"], 2)

    def test_descendant_cycles_do_not_repeat_target_or_ancestors(self):
        h = hierarchy()
        h.children["4"].update({"1", "2", "3"})
        self.assertEqual(h.descendant_ids("2"), ["3", "4"])

    def test_scope_is_loaded_once_for_multiple_hits_in_same_document(self):
        hits = [{"document_id": "doc", "section_id": n} for n in (2, 3)]
        with patch("src.mcp_server.context_navigation.load_hierarchy", return_value=hierarchy()) as load:
            attach_search_ancestors(Mock(), hits, include_hierarchy=True)
        load.assert_called_once()
        self.assertEqual(hits[1]["descendants"], [{"section_id": 4, "title": "Exceptions"}])

    def test_hierarchy_reaches_retrieval_with_optional_exclusions(self):
        for excluded in (None, [12]):
            with self.subTest(excluded=excluded):
                async def run(operation, **kwargs):
                    return operation(Mock())
                hit = {"section_id": 2, "document_id": "doc", "file_name": "policy.pdf", "workspace_id": "ws"}
                with patch.object(server, "_require_search_scope"), patch.object(server, "_prepare_hybrid_search",
                    AsyncMock(return_value=([.1], {}))), patch.object(server, "_run_unified_search",
                    AsyncMock(return_value=[hit])) as retrieve, patch.object(server, "_run_db", side_effect=run), patch.object(
                    server, "get_scoped_document_refs", return_value=[hit]):
                    response = asyncio.run(server.search.fn.__wrapped__(query="approval", workspace_id="ws", document_id="doc",
                        include_hierarchy=True, exclude_section_ids=excluded))
                self.assertNotIn("suggested_files", response)
                self.assertEqual(retrieve.await_count, 1)
                for call in retrieve.await_args_list:
                    self.assertTrue(call.kwargs["include_hierarchy"])
                    self.assertEqual(call.kwargs["filename_query"], "approval")
                    self.assertEqual(call.kwargs["exclude_section_ids"], excluded or [])

    def test_false_skips_hierarchy_in_real_retrieval_wrapper(self):
        async def run(operation, **kwargs):
            return operation(Mock())
        hits = [{"document_id": "doc", "section_id": 2}]
        with patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", False), patch.object(server, "_run_db", side_effect=run), patch.object(server, "unified_search", return_value=hits), patch(
            "src.mcp_server.context_navigation.load_hierarchy") as load:
            asyncio.run(server._run_unified_search("approval", None, workspace_id="ws", file_name=None, fts_query_variants={}))
        load.assert_not_called()

    def test_invalid_boolean_arguments_fail_before_retrieval(self):
        for name in ("include_hierarchy",):
            for value in ("true", 1, None):
                with self.subTest(name=name, value=value), patch.object(server, "_prepare_hybrid_search", AsyncMock()) as prepare:
                    result = asyncio.run(server.search.fn.__wrapped__(query="approval", workspace_id="ws", **{name: value}))
                self.assertIn("error", result)
                prepare.assert_not_awaited()

    def test_tool_schema_exposes_single_boolean_flag_defaulting_to_false(self):
        props = server.search.parameters["properties"]
        for name in ("include_hierarchy",):
            self.assertEqual(props[name]["type"], "boolean")
            self.assertFalse(props[name]["default"])

    def test_legacy_navigation_is_bounded_without_mutating_retrieval_hits(self):
        hit = {"section_id": 2, "ancestors": [], "descendants": [
            {"section_id": n, "title": "Details " * 30} for n in range(3, 100)], "descendant_count": 97,
            "descendants_truncated": False}
        compact = server._compact_search_results([hit], 5, "ws")
        with patch.object(server.settings, "SEARCH_EVIDENCE_MAX_BYTES", 1000):
            result = server._bound_legacy_navigation(compact)
        self.assertLessEqual(serialized_bytes(result), 1000)
        self.assertTrue(result[0]["descendants_truncated"])
        self.assertEqual(result[0]["descendant_count"], 97)
        self.assertEqual(len(hit["descendants"]), 97)


    def test_public_search_has_only_six_arguments(self):
        self.assertEqual(set(server.search.parameters["properties"]), {
            "query", "workspace_id", "document_id", "top_k", "exclude_section_ids",
            "include_hierarchy"})

    def test_search_always_groups_multiple_documents_and_hydrates_evidence(self):
        hits = [{"section_id": n, "document_id": doc, "file_name": name,
                 "workspace_id": "ws", "score": .8,
                 "matched_block": {"block_id": n + 10, "content": "Approval needs review."}}
                for n, doc, name in ((1, "a", "a.pdf"), (2, "b", "b.pdf"), (3, "a", "a.pdf"))]
        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))), patch.object(
            server, "_run_unified_search", AsyncMock(return_value=hits)) as retrieve, patch.object(
            server, "get_scoped_document_refs") as coverage:
            response = asyncio.run(server.search.fn.__wrapped__(query="approval", workspace_id="ws", top_k=3))
        self.assertEqual([d["document_id"] for d in response["documents"]], ["a", "b"])
        self.assertEqual([s["section_id"] for s in response["documents"][0]["sections"]], [1, 3])
        self.assertEqual(response["documents"][1]["sections"][0]["blocks"][0]["block_id"], 12)
        self.assertNotIn("suggested_files", response)
        self.assertTrue(retrieve.await_args.kwargs["include_evidence"])
        self.assertEqual(retrieve.await_args.kwargs["limit"], 3)
        self.assertEqual(retrieve.await_args.kwargs["per_document_limit"], server.settings.SEARCH_BEST_MATCHES_PER_DOCUMENT)
        coverage.assert_not_called()

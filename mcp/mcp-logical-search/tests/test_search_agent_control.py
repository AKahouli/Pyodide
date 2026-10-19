import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from pydantic import TypeAdapter, ValidationError
from src.mcp_server import logical_indexing_server as server


class SearchAgentControlTests(unittest.TestCase):
    def test_agent_rewrites_and_resends_exclusions_without_server_state(self):
        with patch.object(server, "_require_search_scope"), patch.object(
                server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))) as prepare, patch.object(
                server, "_run_unified_search", AsyncMock(return_value=[{
                    "section_id": 202, "section_title": "Cash flows", "file_name": "3M_2018_10K.pdf",
                    "workspace_id": "ws", "score": .8}])) as retrieve:
            for query, exclusions in (("3M FY2018 capital expenditure", None),
                                      ("3M FY2018 purchases of property plant and equipment", [101, 101]),
                                      ("3M FY2018 cash flow statement", None)):
                response = asyncio.run(server.search.fn.__wrapped__(query=query, workspace_id="ws",
                    exclude_section_ids=exclusions, top_k=5))
                self.assertNotIn("error", response)
                self.assertEqual(retrieve.await_args.args[0], query)
                self.assertEqual(retrieve.await_args.kwargs["exclude_section_ids"], [101] if exclusions else [])
                self.assertEqual(retrieve.await_args.kwargs["filename_query"], query)
                self.assertEqual(retrieve.await_args.kwargs["limit"], 5)
            self.assertEqual(prepare.await_count, 3)
            self.assertEqual(retrieve.await_count, 3)

    def test_invalid_exclusions_fail_before_retrieval(self):
        for exclusions in ([True], [0], [-1], ["101"], ["sec_101"], [1.5], "101", {"id": 101},
                           list(range(1, server.settings.REQUEST_COLLECTION_MAX_ITEMS + 2))):
            with self.subTest(exclusions=exclusions), patch.object(server, "_prepare_hybrid_search", AsyncMock()) as prepare:
                response = asyncio.run(server.search.fn.__wrapped__(query="cash flows", workspace_id="ws",
                    exclude_section_ids=exclusions))
            self.assertIn("error", response)
            prepare.assert_not_awaited()

    def test_schema_removes_loop_controls_and_accepts_optional_public_numeric_ids(self):
        properties = server.search.parameters["properties"]
        self.assertNotIn("activate_loop", properties)
        self.assertNotIn("loop_counter", properties)
        self.assertIsNone(properties["exclude_section_ids"]["default"])
        adapter = TypeAdapter(server.ExcludeSectionIdsValue)
        self.assertEqual(adapter.validate_python([101, 202]), [101, 202])
        self.assertEqual(adapter.validate_python("[101, 202]"), [101, 202])
        self.assertEqual(adapter.validate_python([]), [])
        self.assertIsNone(adapter.validate_python(None))
        self.assertIsNone(adapter.validate_python("null"))
        for value in ([True], ["101"], [-1], [0],
                      list(range(1, server.settings.REQUEST_COLLECTION_MAX_ITEMS + 2))):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                adapter.validate_python(value)

    def test_mcp_validation_accepts_omitted_null_and_empty_exclusions(self):
        for supplied in ({}, {"exclude_section_ids": None},
                         {"exclude_section_ids": []}, {"exclude_section_ids": [101]}):
            with self.subTest(supplied=supplied), patch.object(server, "_require_search_scope"), patch.object(
                    server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))), patch.object(
                    server, "_run_unified_search", AsyncMock(return_value=[])) as retrieve:
                asyncio.run(server.search.run({"query": "cash flows", "workspace_id": "ws", **supplied}))
            self.assertEqual(retrieve.await_args.kwargs["exclude_section_ids"],
                             supplied.get("exclude_section_ids") or [])

    def test_single_call_failure_and_cancellation_propagate(self):
        for failure in (asyncio.TimeoutError(), asyncio.CancelledError()):
            with self.subTest(failure=type(failure)), patch.object(server, "_require_search_scope"), patch.object(
                    server, "_prepare_hybrid_search", AsyncMock(side_effect=failure)), patch.object(
                    server, "_run_unified_search", AsyncMock()) as retrieve:
                with self.assertRaises(type(failure)):
                    asyncio.run(server.search.fn.__wrapped__(query="cash flows", workspace_id="ws"))
            retrieve.assert_not_awaited()

    def test_exclusion_does_not_bypass_workspace_authorization(self):
        with patch.object(server, "_get_effective_workspace_ids", return_value=["allowed"]), patch.object(
                server, "_prepare_hybrid_search", AsyncMock()) as prepare:
            with self.assertRaises(server.AuthorizationScopeError):
                asyncio.run(server.search.fn.__wrapped__(query="cash flows", workspace_id="other",
                    exclude_section_ids=[101]))
        prepare.assert_not_awaited()

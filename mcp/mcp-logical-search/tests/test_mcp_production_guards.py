import asyncio
import json
import threading
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy import select, literal

from src.mcp_server import db_helpers as db
from src.mcp_server import logical_indexing_server as server
from src.mcp_server.context_navigation import Hierarchy


class McpProductionGuardTests(unittest.TestCase):
    def test_resources_execute_database_work_off_event_loop(self):
        loop_thread = threading.get_ident()
        doc = SimpleNamespace(id="doc", workspace_id="ws", source=None,
                              total_pages=1, created_at="today", overview="Overview",
                              processing_time_ms=1)

        def lookup(*args, **kwargs):
            self.assertNotEqual(threading.get_ident(), loop_thread)
            self.assertEqual(kwargs["workspace_id"], ["ws"])
            return doc

        def listing(*args, **kwargs):
            lookup(*args, **kwargs)
            return [doc]

        async def read():
            listed = json.loads(await server.list_documents_resource.read())
            self.assertEqual(listed[0]["document_id"], "doc")
            self.assertNotIn("file_name", listed[0])
            for resource in (server.get_document_resource, server.get_document_overview_resource,
                             server.get_document_blocks_resource, server.get_document_sections_resource):
                await resource.fn("doc")

        with patch.object(server, "_get_effective_workspace_ids", return_value=["ws"]), patch.object(
            server, "get_db_session_sync", side_effect=lambda: nullcontext(Mock())
        ), patch.object(server, "db_list_documents", side_effect=listing), patch.object(
            server, "get_document_by_internal_id", side_effect=lookup
        ), patch.object(server, "get_blocks_for_document", return_value=[]), patch.object(
            server, "get_sections_for_document", return_value=[]
        ):
            asyncio.run(read())

    def test_stream_budget_stops_consumption_and_closes_cursor(self):
        def rows():
            yield {"content_bytes": 10}
            yield {"content_bytes": 1000}
            self.fail("Read another row after exceeding the budget")

        session = Mock()
        result = session.execute.return_value
        result.mappings.return_value = rows()
        iterator = db._bounded_context_rows(session, select(literal(1)), {}, 600)
        self.assertEqual(next(iterator)[1], 334)
        with self.assertRaises(db.ContextContentLimitError):
            next(iterator)
        result.close.assert_called_once()
        options = session.execute.call_args.args[0].get_execution_options()
        self.assertTrue(options["stream_results"])
        self.assertEqual(options["yield_per"], 1)

    def test_large_context_provides_section_read_recovery(self):
        target = SimpleNamespace(id=42, section_id="target")
        doc = SimpleNamespace(id="doc", workspace_id="ws", file_name="old.pdf")
        hierarchy = Hierarchy([{"id": 42, "section_id": "target", "title": "Target"}])
        with patch.object(db, "_resolve_section", return_value=(target, "doc")), patch.object(
            db, "get_document_by_internal_id", return_value=doc
        ), patch("src.mcp_server.context_navigation.load_hierarchy", return_value=hierarchy), patch.object(
            db, "_get_sections_by_ids", return_value=[target]
        ), patch.object(db, "_section_content_batch", side_effect=db.ContextContentLimitError):
            result = db.expand_section_context(Mock(), "42", ["doc"])
        self.assertFalse(result["context_complete"])
        self.assertEqual(result["stop_reason"], "content_load_budget")
        self.assertEqual(result["required_next_tool_call"], {"tool": "read_sections", "arguments": {
            "section_id": ["42"], "workspace_id": "ws", "include_images": False}})

        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_run_db", AsyncMock(side_effect=lambda operation, **kwargs: operation(None))
        ), patch.object(server, "_resolve_document_id", return_value=["doc"]), patch.object(
            server, "expand_section_context", return_value=result
        ), patch.object(server, "paginate_context") as paginate:
            response = asyncio.run(server.expand_context.fn.__wrapped__(section_id="42", workspace_id="ws"))
        paginate.assert_not_called()
        self.assertFalse(response["context_complete"])
        self.assertEqual(response["document_id"], "doc")
        self.assertNotIn("file_name", response)

import asyncio
import time
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from sqlalchemy.orm import Session
from src.db.session import database_budget

from src.mcp_server import db_helpers
import src.mcp_server.logical_indexing_server as server


class ReaderLimitTests(unittest.TestCase):
    def test_full_document_reads_ignore_section_pagination_limits(self):
        doc = SimpleNamespace(id="doc", workspace_id="workspace", user_id="user",
                              file_name="report.pdf", source="source", total_pages=2)
        blocks = [SimpleNamespace(id=n, block_id=f"b{n}", block_type="text", content=str(n),
                                  page_number=1, section_id=None) for n in range(3)]
        images = [SimpleNamespace(id=n, content="image", image_base64="", page_number=2,
                                  section_id=None) for n in range(2)]
        session = Mock()
        session.execute.return_value.scalars.return_value.first.return_value = doc
        session.execute.return_value.scalars.return_value.all.side_effect = [blocks, images, []]
        with patch.multiple(db_helpers.settings, READ_BLOCK_PAGE_SIZE=2, READ_IMAGE_PAGE_SIZE=1):
            result = db_helpers.read_full_document_content(session, "report.pdf")

        self.assertEqual(result["content"][0]["content"],
                         "[block_id: 0]\n0\n\n[block_id: 1]\n1\n\n[block_id: 2]\n2")
        self.assertEqual(len(result["content"][0]["images"]), 2)
        self.assertNotIn("pagination", result)
        for call in session.execute.call_args_list[1:]:
            stmt = call.args[0]
            self.assertIsNone(stmt._limit_clause)
            self.assertIsNone(stmt._offset_clause)
            self.assertNotIn("embedding", str(stmt))

    def test_section_continuation_reaches_blocks_after_old_10000_cap(self):
        doc = SimpleNamespace(id="doc-1", source="source", user_id="user", file_name="report.pdf", workspace_id="workspace")
        section = SimpleNamespace(id=42, section_id="sec_1", title="Large section")
        blocks = [SimpleNamespace(id=n, block_type="text", content="evidence", page_number=1)
                  for n in range(10000, 10003)]
        with patch.multiple(db_helpers.settings, READ_BLOCK_PAGE_SIZE=2), patch.object(
            db_helpers, "_resolve_section", return_value=(section, "doc"),
        ), patch.object(db_helpers, "get_document_by_internal_id", return_value=doc), patch.object(
            db_helpers, "_get_section_image_records", return_value=[],
        ), patch.object(db_helpers, "get_blocks_for_document", return_value=blocks) as read:
            result = db_helpers.read_section_with_blocks(object(), "42", ["doc"], block_offset=10000)

        self.assertEqual([b["block_id"] for b in result["blocks"]], [10000, 10001])
        self.assertNotIn("pagination", result)
        self.assertFalse(result["retrieval_complete"])
        self.assertTrue(result["truncated"])
        self.assertEqual(result["required_next_tool_call"]["arguments"]["block_offset"], 10002)
        self.assertEqual(read.call_args.kwargs["limit"], 3)
        self.assertEqual(read.call_args.kwargs["offset"], 10000)

    def test_byte_budget_does_not_hide_pagination_or_omitted_ids(self):
        result = {
            "file_name": "report.pdf", "workspace_id": "workspace",
            "content": [{"page_number": 1, "blocks": [{"block_id": 7, "content": "too large"}], "images": []}],
            "pagination": {"block_offset": 0, "image_offset": 0, "has_more": True,
                           "next_block_offset": 1, "next_image_offset": 0},
        }
        server._apply_read_content_batch_budget([result], 1)
        self.assertFalse(result["retrieval_complete"])
        self.assertEqual(result["omitted_evidence"], [{"block_id": 7}])
        self.assertEqual(result["required_next_tool_call"]["arguments"]["block_offset"], 1)

    def test_last_continuation_page_does_not_claim_complete_document(self):
        result = {"content": [], "pagination": {"block_offset": 10, "has_more": False}}
        server._apply_read_content_batch_budget([result], 1000)
        self.assertFalse(result["retrieval_complete"])
        self.assertNotIn("required_next_tool_call", result)

    def test_deadline_stops_next_sql_and_removes_listener(self):
        session = Session()
        connection = Mock()
        deadline = time.monotonic() + 10

        def operation(current_session):
            for listener in current_session.dispatch.do_orm_execute:
                listener(None)
            with patch.object(server.time, "monotonic", return_value=deadline + 1):
                for listener in current_session.dispatch.do_orm_execute:
                    listener(None)

        async def run_db(callback, *, deadline):
            with database_budget(session, deadline, None):
                return callback(session)

        with patch.object(server, "_run_db", side_effect=run_db), patch.object(
            session, "connection", return_value=connection,
        ):
            with self.assertRaises(asyncio.TimeoutError):
                asyncio.run(server._run_reader_db(operation, deadline))
        connection.exec_driver_sql.assert_called_once()
        self.assertIn("SET LOCAL statement_timeout =", connection.exec_driver_sql.call_args.args[0])
        self.assertEqual(list(session.dispatch.do_orm_execute), [])
        session.close()

    def test_reader_deadline_propagates_to_admission(self):
        deadline = time.monotonic() + 10
        async def run_db(callback, *, deadline):
            return callback(object())
        with patch.object(server, "_run_db", side_effect=run_db) as run:
            self.assertEqual(asyncio.run(server._run_reader_db(lambda _: "ok", deadline)), "ok")
        self.assertEqual(run.call_args.kwargs["deadline"], deadline)

    def test_read_content_loads_all_documents_despite_batch_budget(self):
        block = {"block_id": 1, "content": "evidence"}
        document = {"document_id": "one.pdf", "workspace_id": "workspace",
                    "content": [{"page_number": 1, "blocks": [block], "images": []}]}
        with patch.object(server, "_require_search_scope"), patch.object(
            server, "get_db_session_sync", lambda: nullcontext(object()),
        ), patch.object(server.settings, "READ_CONTENT_BATCH_MAX_BYTES", server._serialized_bytes(block)), patch.object(
            server, "read_full_document_content", return_value=document,
        ) as read:
            result = asyncio.run(server.read_content.fn.__wrapped__(
                workspace_id="workspace", document_id=["one.pdf", "two.pdf"],
            ))
        self.assertEqual(read.call_count, 2)
        self.assertTrue(all(item["content"] == document["content"] for item in result))
        self.assertTrue(all("delivery" not in item for item in result))

    def test_offsets_are_exposed_with_nonnegative_validation(self):
        self.assertNotIn("block_offset", server.read_content.parameters["properties"])
        self.assertNotIn("image_offset", server.read_content.parameters["properties"])
        for tool in (server.read_sections,):
            for name in ("block_offset", "image_offset"):
                self.assertEqual(tool.parameters["properties"][name]["minimum"], 0)

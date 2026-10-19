import asyncio
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy.dialects import postgresql

from src.mcp_server import db_helpers as db
from src.mcp_server import logical_indexing_server as server


class DocumentIdToolTests(unittest.TestCase):
    def test_registered_schemas_replace_filename_argument(self):
        tools = asyncio.run(server.mcp.get_tools())
        for name, tool in tools.items():
            self.assertNotIn("file_name", tool.parameters["properties"], name)
        for name in ("search", "read_content", "get_document_strategy"):
            schema = tools[name].parameters["properties"]["document_id"]
            self.assertIn("array", {item.get("type") for item in schema["anyOf"]})

    def test_registered_docstrings_describe_document_ids(self):
        tools = asyncio.run(server.mcp.get_tools())
        for name, tool in tools.items():
            self.assertNotIn("file_name", tool.description, name)
            self.assertIn("document_id", tool.description, name)

    def test_document_readers_filter_actual_ids_and_workspace(self):
        for helper in (db.get_document_total_pages, db.read_full_document_content):
            session = Mock()
            session.execute.return_value.first.return_value = None
            session.execute.return_value.scalars.return_value.first.return_value = None
            self.assertIsNone(helper(session, document_id="doc-123", workspace_id="ws"))
            statement = session.execute.call_args.args[0].compile(dialect=postgresql.dialect())
            self.assertIn("logical_documents.id IN", str(statement))
            self.assertIn("logical_documents.workspace_id IN", str(statement))
            self.assertNotIn("logical_documents.file_name IN", str(statement))
            self.assertIn(["doc-123"], statement.params.values())

    def test_search_rejects_empty_document_scope(self):
        with patch.object(server, "_require_search_scope") as authorize:
            for document_id in ("", " ", [], ["doc-123", " "]):
                result = asyncio.run(server.search.fn.__wrapped__(
                    query="evidence", workspace_id="ws", document_id=document_id))
                self.assertIn("error", result)
            authorize.assert_not_called()

    def test_read_content_schema_has_no_continuation_offsets(self):
        self.assertEqual(set(server.read_content.parameters["properties"]),
                         {"document_id", "workspace_id"})

    def test_search_returns_distinct_ids_for_duplicate_filenames(self):
        hits = [{"section_id": index, "document_id": doc_id, "file_name": "same.pdf",
                 "workspace_id": "ws", "score": .8, "matched_block": {
                     "block_id": index, "content": "Exact evidence."}}
                for index, doc_id in enumerate(("doc-a", "doc-b"), 1)]
        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))
        ) as prepare, patch.object(
            server, "_run_unified_search", AsyncMock(return_value=hits)
        ) as retrieve:
            result = asyncio.run(server.search.run({
                "query": "evidence", "workspace_id": "ws",
                "document_id": ["doc-a", "doc-b"],
            }))
        self.assertEqual(prepare.await_args.kwargs["document_id"], ["doc-a", "doc-b"])
        self.assertEqual(retrieve.await_args.kwargs["document_id"], ["doc-a", "doc-b"])
        payload = json.loads(result.content[0].text)
        self.assertEqual([doc["document_id"] for doc in payload["documents"]],
                         ["doc-a", "doc-b"])
        self.assertNotIn("file_name", str(payload))

    def test_citation_responses_preserve_document_ids(self):
        for tool, helper in (
            (server.locate_answer_citations, "locate_answer_citation_positions"),
            (server.locate_answer_citations_mistral, "locate_answer_citation_positions_mistral"),
        ):
            with patch.object(server, "_require_search_scope"), patch.object(
                server, "_run_db", AsyncMock(side_effect=lambda operation, **kwargs: operation(None))
            ), patch.object(server, helper, return_value={"citations": [{
                "document_id": "doc-123", "file_name": "same.pdf", "reference": "[1]",
                "source": "source", "block_id": 7,
            }]}):
                result = asyncio.run(tool.fn.__wrapped__(workspace_id="ws", citations=[
                    server.LocateAnswerCitationInput(block_id="7", reference=1,
                                                    evidence_text="Exact evidence.")]))
            self.assertEqual(result["citations"][0]["document_id"], "doc-123")
            self.assertNotIn("file_name", result["citations"][0])


if __name__ == "__main__":
    unittest.main()

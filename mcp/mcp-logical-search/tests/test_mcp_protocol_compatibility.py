"""Exercise the real MCP protocol after security dependency upgrades."""
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastmcp import Client
from starlette.requests import Request
from src.mcp_server import logical_indexing_server as server


class ProtocolCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_protocol_keeps_active_citation_locator(self):
        for mistral in (False, True):
            headers = [(b"mistral", b"true")] if mistral else []
            request = Request({"type": "http", "headers": headers, "state": {}})
            with patch("fastmcp.server.dependencies.get_http_request", return_value=request):
                async with Client(server.mcp) as client:
                    names = {tool.name for tool in await client.list_tools()}
            self.assertIn("search", names)
            self.assertIn("locate_answer_citations_mistral" if mistral else "locate_answer_citations", names)
            self.assertNotIn("locate_answer_citations" if mistral else "locate_answer_citations_mistral", names)

    async def test_protocol_preserves_document_content_and_scope_rejection(self):
        expected = {"document_id": "doc", "workspace_id": "dynamic-workspace",
                    "content": [{"content": "Evidence [block_id: 42]", "images": []}]}
        with patch.object(server, "_get_effective_workspace_ids", return_value=["dynamic-workspace"]), patch.object(
                server, "_run_reader_db", AsyncMock(side_effect=lambda operation, *args, **kwargs: operation(None))), patch.object(
                server, "read_full_document_content", return_value=expected) as read:
            async with Client(server.mcp) as client:
                result = await client.call_tool("read_content", {"workspace_id": "dynamic-workspace", "document_id": "doc"})
                self.assertEqual(json.loads(result.content[0].text), expected)
                with self.assertRaisesRegex(Exception, "Error calling tool"):
                    await client.call_tool("read_content", {"workspace_id": "other", "document_id": "doc"})
            read.assert_called_once()

    async def test_protocol_errors_hide_sensitive_provider_text(self):
        secret = "private-provider-document-fragment"
        with patch.object(server, "_get_effective_workspace_ids", return_value=["dynamic-workspace"]), patch.object(
                server, "_run_reader_db", AsyncMock(side_effect=RuntimeError(secret))), self.assertLogs(
                "fastmcp.server.server", level="ERROR") as captured:
            async with Client(server.mcp) as client:
                with self.assertRaises(Exception) as raised:
                    await client.call_tool("read_content", {"workspace_id": "dynamic-workspace", "document_id": "doc"})
            self.assertNotIn(secret, str(raised.exception))
            self.assertNotIn(secret, "\n".join(captured.output))

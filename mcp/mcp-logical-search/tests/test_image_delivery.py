import asyncio
import base64
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy.dialects import postgresql
from mcp.types import ImageContent
from PIL import Image

from src.mcp_server import image_delivery as delivery
from src.mcp_server import db_helpers
from src.mcp_server import logical_indexing_server as server
from src.modules.embeddings import embedding_configured


PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="


class ImageDeliveryTests(unittest.TestCase):
    def test_image_content_never_falls_back_to_image_bytes(self):
        buffer = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buffer, format="PNG")
        png = base64.b64encode(buffer.getvalue()).decode("ascii")
        for content in (None, "", png, "data:image/png;base64," + png, "Revenue chart"):
            with self.subTest(content=content[:20] if content else content):
                image = SimpleNamespace(id="im", content=content, image_base64=png)
                with patch.object(db_helpers, "_compress_image_base64", return_value=png):
                    response = server._tool_multimodal_response(db_helpers._serialize_image(image))
                expected = content if content == "Revenue chart" else ""
                self.assertEqual(response[0]["content"], expected)
                self.assertEqual(db_helpers._serialize_image_metadata(image)["content"], expected)
                self.assertNotIn("image_base64", response[0])
                self.assertIsInstance(response[1], ImageContent)
                self.assertEqual(response[1].data, png)

    def test_read_content_returns_all_chunk_images_as_mcp_items(self):
        def read_document(session, document_id, workspace_id):
            return {"document_id": document_id, "workspace_id": workspace_id,
                    "content": [{"content": "Findings\n\n[block_id: 42]\nRevenue",
                                 "images": [{"image_id": document_id, "content": "Chart",
                                             "image_base64": PNG}]}]}

        async def run(operation, deadline):
            return operation(None)

        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_run_reader_db", side_effect=run), patch.object(
            server, "read_full_document_content", side_effect=read_document), patch.object(
            server.settings, "READ_CONTENT_BATCH_MAX_BYTES", 1):
            result = asyncio.run(server.read_content.run({
                "document_id": ["one", "two"], "workspace_id": "allowed"})).content
        payload = json.loads(result[0].text)
        self.assertEqual([doc["document_id"] for doc in payload], ["one", "two"])
        self.assertEqual(len(result), 3)
        self.assertTrue(all(isinstance(item, ImageContent) for item in result[1:]))
        self.assertTrue(all(item.data == PNG for item in result[1:]))
        for index, doc in enumerate(payload, 1):
            self.assertEqual(set(doc), {"document_id", "workspace_id", "content"})
            self.assertEqual(doc["content"][0]["images"][0]["image_content_index"], index)
            self.assertNotIn("image_base64", doc["content"][0]["images"][0])

    def image(self, identity="im"):
        return SimpleNamespace(id=identity, image_base64=PNG, content="Revenue chart")

    def test_batch_loading_is_workspace_scoped_and_deduplicates_image_bytes(self):
        session = Mock()
        session.execute.return_value.scalars.return_value.all.return_value = [self.image()]
        response = {"blocks": [
            {"image_id": "im", "content": "Revenue chart"},
            {"image_id": "im", "block_id": 1, "content": "Revenue chart"},
        ]}
        with patch.object(delivery, "_serialize_image", return_value={"image_base64": PNG}) as serialize:
            result = server._tool_multimodal_response(delivery.attach_evidence_images(session, response, "allowed"))
        sql = str(session.execute.call_args.args[0].compile(dialect=postgresql.dialect()))
        self.assertIn("logical_documents.workspace_id IN", sql)
        self.assertIn("logical_images.id IN", sql)
        self.assertEqual(session.execute.call_args.args[0].compile().params["workspace_id_1"], ["allowed"])
        serialize.assert_called_once()
        self.assertEqual(len(result), 2)
        self.assertIsInstance(result[1], ImageContent)
        self.assertEqual(result[1].data, PNG)
        self.assertEqual([block["image_content_index"] for block in result[0]["blocks"]], [1, 1])
        self.assertNotIn("image_base64", json.dumps(result[0]))

    def test_image_blocks_resolve_payload_by_full_image_identity(self):
        session = Mock()
        session.execute.return_value.all.return_value = [SimpleNamespace(id=42, image_id="im")]
        session.execute.return_value.scalars.return_value.all.return_value = [self.image()]
        block = {"block_id": 42, "block_type": "image/chart", "content": "Revenue chart"}
        with patch.object(delivery, "_serialize_image", return_value={"image_base64": PNG}):
            delivery.attach_evidence_images(session, [block], ["allowed"])
        sql = str(session.execute.call_args_list[0].args[0].compile(dialect=postgresql.dialect()))
        for field in ("document_id", "section_id", "page_number", "content", "bbox"):
            self.assertIn("logical_blocks." + field, sql)
        self.assertEqual(block["image_id"], "im")
        self.assertEqual(block["image_base64"], PNG)

    def test_missing_payload_and_budget_omissions_are_explicit(self):
        session = Mock()
        session.execute.return_value.scalars.return_value.all.return_value = [self.image()]
        response = [{"image_id": "missing", "content": "chart"}, {"image_id": "im", "content": "chart"}]
        with patch.object(delivery, "get_settings", return_value=SimpleNamespace(READ_CONTENT_BATCH_MAX_BYTES=1)), patch.object(
            delivery, "_serialize_image", return_value={"image_base64": PNG}):
            delivery.attach_evidence_images(session, response, "allowed")
        self.assertEqual([item["image_status"] for item in response], ["not_found", "omitted_byte_budget"])
        self.assertIn("read_sections", response[1]["image_next_action"])
        self.assertTrue(all("image_base64" not in item for item in response))

    def test_plain_text_requires_no_image_query(self):
        session = Mock()
        delivery.attach_evidence_images(session, {"blocks": [{"block_id": 42, "content": "text"}]}, "allowed")
        session.execute.assert_not_called()

    def test_context_page_attaches_only_images_in_delivered_markers(self):
        session = Mock()
        session.execute.return_value.scalars.return_value.all.return_value = [self.image()]
        response = {"context_version": "v", "content": '[image {"image_id": "im", "page_number": 1}]\nRevenue chart'}
        with patch.object(delivery, "_serialize_image", return_value={"image_base64": PNG}):
            result = server._tool_multimodal_response(delivery.attach_evidence_images(session, response, "allowed"))
        self.assertEqual(result[0]["images"][0]["image_content_index"], 1)
        self.assertIn("Revenue chart", result[0]["content"])

    def test_search_and_section_search_return_image_content_items(self):
        section = {"section_id": 42, "document_id": "doc", "workspace_id": "allowed", "blocks": [
            {"image_id": "im", "block_type": "image", "content": "Revenue chart"}]}

        async def run(operation, deadline):
            session = Mock()
            session.execute.return_value.scalars.return_value.all.return_value = [self.image()]
            return operation(session)

        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))), patch.object(
            server, "_run_unified_search", AsyncMock(return_value=[{"section_id": 42, "evidence": section}])), patch.object(
            server, "_run_db", side_effect=run), patch.object(delivery, "_serialize_image", return_value={"image_base64": PNG}), patch.object(
            server, "get_query_embedding", AsyncMock(return_value=[.1])), patch.object(
            server, "search_section_evidence", return_value=[section]):
            search = asyncio.run(server.search.run({"query": "chart", "workspace_id": "allowed"})).content
            focused = asyncio.run(server.search_in_sections.fn.__wrapped__(
                query="chart", workspace_id="allowed", section_id="42"))
        self.assertIsInstance(search[1], ImageContent)
        self.assertEqual(json.loads(search[0].text)["documents"][0]["sections"][0]["blocks"][0]["image_content_index"], 1)
        self.assertIsInstance(focused[1], ImageContent)
        self.assertEqual(focused[0]["documents"][0]["sections"][0]["blocks"][0]["image_content_index"], 1)

    def test_block_and_context_tools_attach_images(self):
        async def run(operation, deadline):
            session = Mock()
            session.execute.return_value.all.return_value = [SimpleNamespace(id=42, image_id="im")]
            session.execute.return_value.scalars.return_value.all.return_value = [self.image()]
            return operation(session)

        block = {"block_id": 42, "block_type": "image/chart", "content": "Revenue chart", "document_id": "doc"}
        context = {"section_id": 7, "target_section_id": 7, "workspace_id": "allowed",
            "document_id": "doc", "content": '[image {"image_id": "im", "page_number": 1}]\nRevenue chart'}
        with patch.object(server, "_require_search_scope"), patch.object(server, "_run_reader_db", side_effect=run), patch.object(
            server, "_run_db", side_effect=run), patch.object(server, "_resolve_document_id", return_value=["doc"]), patch.object(
            server, "read_blocks_by_ids", return_value=[block]), patch.object(
            server, "expand_section_context", return_value=context), patch.object(
            delivery, "_serialize_image", return_value={"image_base64": PNG}):
            blocks = asyncio.run(server.read_blocks.run({"block_id": "42", "workspace_id": "allowed"})).content
            expanded = asyncio.run(server.expand_context.run({"section_id": "7", "workspace_id": "allowed"})).content
            navigation = asyncio.run(server.expand_context.run({"section_id": "7", "workspace_id": "allowed", "include_content": False})).content
        self.assertIsInstance(blocks[1], ImageContent)
        self.assertEqual(json.loads(blocks[0].text)[0]["image_content_index"], 1)
        self.assertIsInstance(expanded[1], ImageContent)
        self.assertEqual(json.loads(expanded[0].text)["images"][0]["image_content_index"], 1)
        self.assertFalse(any(isinstance(item, ImageContent) for item in navigation))

    def test_litellm_configuration_enables_image_search_query_embeddings(self):
        configured = SimpleNamespace(LITELLM_BASE_URL="https://gateway.example/v1", LITELLM_API_KEY="test-key",
            SEARCH_RETRIEVAL_RESERVE_SECONDS=0.1)
        self.assertTrue(embedding_configured(configured))
        with patch.object(server, "settings", configured), patch.object(server, "_run_db", AsyncMock(return_value=["english"])), patch.object(
            server, "get_query_embedding", AsyncMock(return_value=[.1])) as embed, patch.object(
            server, "build_fts_query_variants", AsyncMock(return_value={"english": ["chart"]})):
            result = asyncio.run(server._prepare_hybrid_search("chart", "allowed", None, "test",
                deadline=server.time.monotonic() + 10))
        self.assertEqual(result.query_embedding, [.1])
        embed.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()

import asyncio
from contextlib import nullcontext
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, Mock, patch

import src.mcp_server.db_helpers as db_helpers
import src.mcp_server.logical_indexing_server as server


def _call(tool, **kwargs):
    return asyncio.run(tool.fn.__wrapped__(**kwargs))


class MultiFileReadToolTests(unittest.TestCase):
    def test_context_image_projection_only_loads_requested_bytes(self):
        for include_bytes in (False, True):
            with self.subTest(include_bytes=include_bytes):
                session = Mock()
                session.execute.return_value.mappings.return_value.all.return_value = []
                image = SimpleNamespace(id=7, section_id="sec_1", content="Chart", page_number=2)
                if include_bytes:
                    image.image_base64 = "stored-image"
                session.execute.return_value.all.return_value = [image]
                section = SimpleNamespace(id=101, section_id="sec_1", title="Revenue")
                with patch.object(db_helpers, "_get_page_ranges_by_section", return_value={}), patch.object(
                    db_helpers, "_first_decodable_image_base64",
                    side_effect=lambda *values: "stored-image" if "stored-image" in values else "",
                ), patch.object(db_helpers, "_compress_image_base64", return_value="compressed"):
                    result = db_helpers._section_content_batch(
                        session, None, "doc-a", [section], include_image_bytes=include_bytes,
                    )

                statement = session.execute.call_args.args[0]
                columns = list(statement.selected_columns.keys())
                self.assertEqual(columns, ["id", "section_id", "content", "page_number"] + (
                    ["image_base64"] if include_bytes else []
                ))
                self.assertIn("logical_images.document_id =", str(statement))
                self.assertIn("logical_images.section_id IN", str(statement))
                expected = {"image_id": 7, "content": "Chart", "page_number": 2}
                if include_bytes:
                    expected["image_base64"] = "compressed"
                self.assertEqual(result[101]["images"], [expected])

    def setUp(self):
        scope_patch = patch.object(server, "_require_search_scope", lambda **_: None)
        threshold_patch = patch.object(server.settings, "PAGE_THRESHOLD", 20)
        budget_patch = patch.object(server.settings, "READ_CONTENT_BATCH_MAX_BYTES", 500000)
        session_patch = patch.object(
            server,
            "get_db_session_sync",
            lambda: nullcontext(object()),
        )
        scope_patch.start()
        threshold_patch.start()
        budget_patch.start()
        session_patch.start()
        self.addCleanup(scope_patch.stop)
        self.addCleanup(threshold_patch.stop)
        self.addCleanup(budget_patch.stop)
        self.addCleanup(session_patch.stop)

    def test_summary_workflows_are_not_in_mcp_registry(self):
        tools = asyncio.run(server.mcp.get_tools())

        self.assertNotIn("summarize", tools)
        self.assertIn("read_sections", tools)
        self.assertNotIn("read_section", tools)
        self.assertNotIn("resume", tools)
        self.assertNotIn("get_document_map", tools)
        self.assertNotIn("read_page", tools)

    def test_get_document_strategy_returns_grouped_read_content_call_for_single_file(self):
        get_pages = lambda session, document_id, workspace_id: {
            "user_id": "user",
            "document_id": document_id,
            "workspace_id": workspace_id,
            "total_pages": 2,
        }

        with patch.object(server, "get_document_total_pages", get_pages):
            result = _call(
                server.get_document_strategy,
                workspace_id="workspace",
                document_id="small.pdf",
            )

        self.assertEqual(result, {
            "workspace_id": "workspace",
            "next_tool_calls": [{
                "tool": "read_content",
                "arguments": {
                    "workspace_id": "workspace",
                    "document_id": ["small.pdf"],
                },
                "after_success": {
                    "next_action": "locate_answer_citations",
                    "do_not_call_for_these_files": [
                            "search",
                            "search_in_sections",
                            "read_sections",
                            "read_blocks",
                            "expand_context",
                    ],
                },
            }],
            "not_found_document_ids": [],
        })

    def test_get_document_strategy_groups_read_and_search_tool_calls(self):
        page_counts = {"small.pdf": 2, "large.pdf": 200}

        def get_pages(session, document_id, workspace_id):
            if document_id not in page_counts:
                return None
            return {
                "user_id": "user",
                "document_id": document_id,
                "workspace_id": workspace_id,
                "total_pages": page_counts[document_id],
            }

        with patch.object(server, "get_document_total_pages", get_pages):
            result = _call(
                server.get_document_strategy,
                workspace_id="workspace",
                document_id=["small.pdf", "large.pdf", "missing.pdf"],
            )

        self.assertEqual(result["not_found_document_ids"], ["missing.pdf"])
        self.assertEqual(result["next_tool_calls"], [
            {
                "tool": "read_content",
                "arguments": {
                    "workspace_id": "workspace",
                    "document_id": ["small.pdf"],
                },
                "after_success": {
                    "next_action": "locate_answer_citations",
                    "do_not_call_for_these_files": [
                            "search",
                            "search_in_sections",
                            "read_sections",
                            "read_blocks",
                            "expand_context",
                    ],
                },
            },
            {
                "tool": "search",
                "arguments": {
                    "workspace_id": "workspace",
                    "document_id": ["large.pdf"],
                },
            },
        ])

    def test_get_document_strategy_allows_one_read_all_file_out_of_six(self):
        page_counts = {
            "small.pdf": 2,
            "large-1.pdf": 200,
            "large-2.pdf": 200,
            "large-3.pdf": 200,
            "large-4.pdf": 200,
            "large-5.pdf": 200,
        }

        def get_pages(session, document_id, workspace_id):
            return {
                "user_id": "user",
                "document_id": document_id,
                "workspace_id": workspace_id,
                "total_pages": page_counts[document_id],
            }

        document_ids = list(page_counts)
        with patch.object(server, "get_document_total_pages", get_pages):
            result = _call(
                server.get_document_strategy,
                workspace_id="workspace",
                document_id=document_ids,
            )

        self.assertEqual(
            result["next_tool_calls"][0]["arguments"]["document_id"],
            ["small.pdf"],
        )
        self.assertEqual(
            result["next_tool_calls"][1]["arguments"]["document_id"],
            document_ids[1:],
        )

    def test_read_content_keeps_single_file_response(self):
        read_document = lambda session, document_id, workspace_id: {
            "user_id": "user",
            "source": "source",
            "document_id": document_id,
            "workspace_id": workspace_id,
            "content": [],
        }

        with patch.object(server, "read_full_document_content", read_document):
            result = _call(
                server.read_content,
                workspace_id="workspace",
                document_id="small.pdf",
            )

        self.assertIsInstance(result, dict)
        self.assertEqual(result, {
            "document_id": "small.pdf",
            "workspace_id": "workspace",
            "content": [],
        })

    def test_read_content_returns_every_document_without_a_byte_budget(self):
        def read_document(session, document_id, workspace_id):
            return {
                "document_id": document_id,
                "workspace_id": workspace_id,
                "content": [{
                    "content": document_id,
                    "images": [],
                }],
            }

        with (
            patch.object(server, "read_full_document_content", read_document),
            patch.object(server, "_serialized_bytes", return_value=10),
            patch.object(server.settings, "READ_CONTENT_BATCH_MAX_BYTES", 10),
        ):
            result = _call(
                server.read_content,
                workspace_id="workspace",
                document_id=["one.pdf", "two.pdf"],
            )

        self.assertEqual([item["document_id"] for item in result], ["one.pdf", "two.pdf"])
        for item in result:
            self.assertEqual(item["content"][0]["content"], item["document_id"])
            self.assertNotIn("delivery", item)
            self.assertNotIn("truncated", item)
            self.assertNotIn("required_next_tool_call", item)

    def test_read_content_returns_ordered_results_for_file_list(self):
        def read_document(session, document_id, workspace_id):
            if document_id == "missing.pdf":
                return None
            return {
                "user_id": "user",
                "source": "source",
                "document_id": document_id,
                "workspace_id": workspace_id,
                "content": [{"content": "Evidence", "images": []}],
            }

        with patch.object(server, "read_full_document_content", read_document):
            result = _call(
                server.read_content,
                workspace_id="workspace",
                document_id=["one.pdf", "missing.pdf", "two.pdf"],
            )

        self.assertEqual(
            [item["document_id"] for item in result],
            ["one.pdf", "missing.pdf", "two.pdf"],
        )
        self.assertEqual(
            result[1]["error"],
            "Document not found for the given scope",
        )
        self.assertTrue(
            all("user_id" not in item and "source" not in item for item in result)
        )
        self.assertEqual(result[0]["content"], [{"content": "Evidence", "images": []}])
        self.assertEqual(result[2]["content"], [{"content": "Evidence", "images": []}])

    def test_read_content_has_no_workflow_metadata_in_mistral_mode(self):
        read_document = lambda session, document_id, workspace_id: {
            "document_id": document_id,
            "workspace_id": workspace_id,
            "content": [],
        }
        token = server.set_request_mistral(True)
        try:
            with patch.object(server, "read_full_document_content", read_document):
                result = _call(
                    server.read_content,
                    workspace_id="workspace",
                    document_id="small.pdf",
                )
        finally:
            server.clear_request_mistral(token)

        self.assertEqual(set(result), {"document_id", "workspace_id", "content"})

    def test_multi_file_tools_expose_string_or_array_schema(self):
        for tool in (
            server.get_document_strategy,
            server.read_content,
            server.search,
        ):
            document_id_schema = tool.parameters["properties"]["document_id"]
            types = {entry.get("type") for entry in document_id_schema["anyOf"]}
            self.assertLessEqual({"string", "array", "null"}, types)
            self.assertIn("complete list in one batched tool call", document_id_schema["description"])

    def test_all_retrieval_tools_expose_multi_workspace_schema(self):
        for tool in (
            server.get_document_strategy,
            server.read_content,
            server.search,
            server.read_sections,
            server.read_blocks,
            server.expand_context,
            server.locate_answer_citations,
            server.locate_answer_citations_mistral,
        ):
            workspace_schema = tool.parameters["properties"]["workspace_id"]
            types = {entry.get("type") for entry in workspace_schema["anyOf"]}
            self.assertLessEqual({"string", "array", "null"}, types, tool.name)

    def test_read_content_resolves_each_unique_file_once_across_workspaces(self):
        calls = []

        def read_document(session, document_id, workspace_id):
            calls.append((workspace_id, document_id))
            if (workspace_id, document_id) not in {
                ("workspace-a", "one.pdf"),
                ("workspace-b", "two.pdf"),
            }:
                return None
            return {
                "document_id": document_id,
                "workspace_id": workspace_id,
                "content": [],
            }

        with patch.object(server, "read_full_document_content", read_document):
            result = _call(
                server.read_content,
                workspace_id=["workspace-a", "workspace-b"],
                document_id=["one.pdf", "two.pdf"],
            )

        self.assertEqual(
            [(item["workspace_id"], item["document_id"]) for item in result],
            [
                ("workspace-a", "one.pdf"),
                ("workspace-b", "two.pdf"),
            ],
        )
        self.assertEqual(calls, [
            ("workspace-a", "one.pdf"),
            ("workspace-a", "two.pdf"),
            ("workspace-b", "two.pdf"),
        ])

    def test_multi_workspace_strategy_aggregates_followups_and_stops_after_match(self):
        page_counts = {
            ("workspace-a", "one.pdf"): 2,
            ("workspace-b", "two.pdf"): 200,
        }
        calls = []

        def get_pages(session, document_id, workspace_id):
            calls.append((workspace_id, document_id))
            total_pages = page_counts.get((workspace_id, document_id))
            if total_pages is None:
                return None
            return {"total_pages": total_pages}

        with patch.object(server, "get_document_total_pages", get_pages):
            result = _call(
                server.get_document_strategy,
                workspace_id=["workspace-a", "workspace-b"],
                document_id=["one.pdf", "two.pdf"],
            )

        self.assertEqual(result["next_tool_calls"][0]["arguments"], {
            "workspace_id": "workspace-a",
            "document_id": ["one.pdf"],
        })
        self.assertEqual(result["next_tool_calls"][1]["arguments"], {
            "workspace_id": "workspace-b",
            "document_id": ["two.pdf"],
        })
        self.assertEqual(result["not_found_document_ids"], [])
        self.assertEqual(calls, [
            ("workspace-a", "one.pdf"),
            ("workspace-a", "two.pdf"),
            ("workspace-b", "two.pdf"),
        ])

    def test_multi_workspace_strategy_reports_a_file_missing_only_once(self):
        with patch.object(server, "get_document_total_pages", return_value=None) as get_pages:
            result = _call(
                server.get_document_strategy,
                workspace_id=["workspace-a", "workspace-b"],
                document_id=["missing.pdf"],
            )

        self.assertEqual(result["next_tool_calls"], [])
        self.assertEqual(result["not_found_document_ids"], ["missing.pdf"])
        self.assertEqual(get_pages.call_count, 2)

    def test_multi_workspace_strategy_returns_one_aggregated_group(self):
        locations = {
            ("workspace-a", "one.pdf"),
            ("workspace-b", "two.pdf"),
        }

        def get_pages(session, document_id, workspace_id):
            if (workspace_id, document_id) not in locations:
                return None
            return {"total_pages": 2}

        with patch.object(server, "get_document_total_pages", side_effect=get_pages):
            result = _call(
                server.get_document_strategy,
                workspace_id=["workspace-a", "workspace-b"],
                document_id=["one.pdf", "two.pdf"],
            )

        self.assertEqual(len(result["next_tool_calls"]), 1)
        self.assertEqual(result["next_tool_calls"][0]["arguments"], {
            "workspace_id": ["workspace-a", "workspace-b"],
            "document_id": ["one.pdf", "two.pdf"],
        })

    def test_unique_id_tools_do_not_expose_document_id(self):
        for tool in (
            server.read_sections,
            server.read_blocks,
            server.expand_context,
            server.locate_answer_citations,
            server.locate_answer_citations_mistral,
        ):
            self.assertNotIn("document_id", tool.parameters["properties"])

    def test_read_sections_resolves_multiple_sections_in_one_call(self):
        section = {
            "section_id": 42,
            "document_id": "resolved.pdf",
            "workspace_id": "workspace",
            "images": [],
            "blocks": [],
        }
        with (
            patch.object(server, "_resolve_document_id", return_value=[10, 20]) as resolve,
            patch.object(
                server,
                "read_sections_with_blocks",
                return_value=[section, None],
            ) as read,
        ):
            result = _call(
                server.read_sections,
                section_id=["42", "missing"],
                workspace_id="workspace",
            )

        resolve.assert_not_called()
        self.assertEqual(result["sections"][0]["document_id"], "resolved.pdf")
        self.assertNotIn("delivery", result["sections"][0])
        self.assertEqual(
            result["sections"][1],
            {"section_id": "missing", "error": "Section not found"},
        )
        read.assert_called_once_with(ANY, ["42", "missing"], "workspace", True, 0, 0)

    def test_read_section_merges_exact_image_match_into_block(self):
        matched_image = SimpleNamespace(
            id="image-1",
            page_number=46,
            content="table content",
            bbox=[1, 2, 3, 4],
        )
        unmatched_image = SimpleNamespace(
            id="image-2",
            page_number=47,
            content="chart content",
            bbox=[5, 6, 7, 8],
        )
        blocks = [
            SimpleNamespace(
                id=100,
                block_type="image/table",
                content="table content",
                page_number=46,
                bbox=[1, 2, 3, 4],
            ),
            SimpleNamespace(
                id=101,
                block_type="text/text",
                content="paragraph",
                page_number=46,
                bbox=[9, 10, 11, 12],
            ),
        ]
        section = SimpleNamespace(id=42, section_id="section-key", title="Results")
        document = SimpleNamespace(id="doc-1", 
            source="source",
            user_id="user",
            file_name="report.pdf",
            workspace_id="workspace",
        )

        def serialize(image):
            return {
                "image_id": image.id,
                "content": image.content,
                "image_base64": "aGVsbG8=",
            }

        with (
            patch.object(db_helpers, "_resolve_section", return_value=(section, "doc-1")),
            patch.object(db_helpers, "get_document_by_internal_id", return_value=document),
            patch.object(
                db_helpers,
                "_get_section_image_records",
                return_value=[matched_image, unmatched_image],
            ),
            patch.object(db_helpers, "get_blocks_for_document", return_value=blocks),
            patch.object(db_helpers, "_serialize_image", side_effect=serialize),
        ):
            result = db_helpers.read_section_with_blocks(
                object(),
                "42",
                ["doc-1"],
            )

        self.assertEqual(result["blocks"][0]["image_id"], "image-1")
        self.assertNotIn("pagination", result)
        self.assertNotIn("page_range", result)
        self.assertTrue(all("page_number" not in block for block in result["blocks"]))
        self.assertEqual(result["blocks"][0]["image_base64"], "aGVsbG8=")
        self.assertNotIn("image_id", result["blocks"][1])
        self.assertNotIn("required_next_tool_call", result["blocks"][1])
        self.assertEqual([image["image_id"] for image in result["images"]], ["image-2"])

        multimodal = server._tool_multimodal_response(result)
        payload = multimodal[0]
        self.assertEqual(payload["blocks"][0]["image_content_index"], 1)
        self.assertNotIn("image_base64", payload["blocks"][0])
        self.assertEqual(payload["images"][0]["image_content_index"], 2)

    def test_read_section_previews_long_blocks_and_points_to_read_blocks(self):
        blocks = [
            SimpleNamespace(id=100, block_type="text/text", content="a" * 1001,
                            page_number=1, bbox=None),
            SimpleNamespace(id=101, block_type="text/text", content="b" * 1000,
                            page_number=1, bbox=None),
        ]
        section = SimpleNamespace(id=42, section_id="section-key", title="Results")
        document = SimpleNamespace(id="doc-1", source=None, user_id="user", file_name="report.pdf",
                                   workspace_id="workspace")
        with (
            patch.object(db_helpers, "_resolve_section", return_value=(section, "doc-1")),
            patch.object(db_helpers, "get_document_by_internal_id", return_value=document),
            patch.object(db_helpers, "_get_section_image_records", return_value=[]),
            patch.object(db_helpers, "get_blocks_for_document", return_value=blocks),
        ):
            result = db_helpers.read_section_with_blocks(object(), "42", ["doc-1"])

        long_block, normal_block = result["blocks"]
        self.assertEqual(long_block["content"], "a" * 1000)
        self.assertEqual(long_block["content_length"], 1001)
        self.assertTrue(long_block["content_truncated"])
        self.assertEqual(long_block["required_next_tool_call"], {
            "tool": "read_blocks",
            "arguments": {"block_id": "100", "workspace_id": "workspace"},
        })
        self.assertEqual(normal_block["content"], "b" * 1000)
        self.assertNotIn("required_next_tool_call", normal_block)

    def test_expand_context_exposes_single_or_multiple_section_ids(self):
        section_id_schema = server.expand_context.parameters["properties"]["section_id"]
        types = {entry.get("type") for entry in section_id_schema["anyOf"]}
        array_schema = next(
            entry for entry in section_id_schema["anyOf"] if entry.get("type") == "array"
        )

        self.assertLessEqual({"string", "array", "null"}, types)
        self.assertIn("one ordered result per ID", section_id_schema["description"])
        self.assertEqual(array_schema["minItems"], 1)
        self.assertEqual(
            array_schema["maxItems"],
            server.settings.REQUEST_COLLECTION_MAX_ITEMS,
        )

    def test_search_tool_schemas_expose_query_and_result_limits(self):
        for tool in (server.search,):
            properties = tool.parameters["properties"]
            self.assertEqual(
                properties["query"]["maxLength"],
                server.settings.REQUEST_QUERY_MAX_CHARS,
            )
            self.assertEqual(properties["top_k"]["minimum"], 1)
            self.assertEqual(
                properties["top_k"]["maximum"], 10,
            )

    def test_citation_schema_exposes_collection_limit(self):
        schema = server.locate_answer_citations.parameters["properties"]["citations"]
        array_schema = next(
            entry for entry in schema["anyOf"] if entry.get("type") == "array"
        )

        self.assertEqual(
            array_schema["maxItems"],
            server.settings.REQUEST_COLLECTION_MAX_ITEMS,
        )

    def test_expand_context_returns_ordered_result_for_each_section_id(self):
        contexts = {
            "42": {
                "target_section_id": 42,
                "file_name": "first.pdf",
                "workspace_id": "workspace",
                "ancestors": [],
                "descendants": [],
            },
            "84": {
                "target_section_id": 84,
                "file_name": "second.pdf",
                "workspace_id": "workspace",
                "ancestors": [],
                "descendants": [],
            },
        }
        with (
            patch.object(server, "_resolve_document_id", return_value=[10, 20]),
            patch.object(
                server,
                "expand_section_context",
                side_effect=lambda session, section_id, doc_ids, **kwargs: contexts.get(section_id),
            ) as expand,
        ):
            result = _call(
                server.expand_context,
                section_id=["42", "missing", "84"],
                workspace_id="workspace",
            )

        self.assertEqual(
            [item.get("target_section_id", item.get("section_id")) for item in result["contexts"]],
            [42, "missing", 84],
        )
        self.assertEqual(
            result["contexts"][1],
            {"section_id": "missing", "error": "Section not found"},
        )
        self.assertEqual(
            [call.args[1] for call in expand.call_args_list],
            ["42", "missing", "84"],
        )

    def test_read_blocks_omits_page_number(self):
        block = SimpleNamespace(id=7, block_id="p1_b1", document_id=10,
                                section_id="section", block_type="text",
                                content="evidence", page_number=1)
        document = SimpleNamespace(id=10, source="source", user_id="user",
                                   file_name="report.pdf", workspace_id="workspace")
        session = Mock()
        session.execute.return_value.scalars.return_value.all.side_effect = [[block], [document]]
        with patch.object(db_helpers, "_public_section_ids_for_blocks", return_value={(10, "section"): 42}):
            result = db_helpers.read_blocks_by_ids(session, ["7"], [10])
        self.assertNotIn("page_number", result[0])

    def test_read_blocks_resolves_multiple_exact_blocks_in_one_call(self):
        blocks = [
            {"block_id": 7, "external_block_id": "p1_b1", "content": "evidence"},
            {"block_id": 8, "external_block_id": "p1_b2", "content": "more"},
        ]
        with (
            patch.object(server, "_resolve_document_id", return_value=[10, 20]) as resolve,
            patch.object(server, "read_blocks_by_ids", return_value=blocks) as read,
        ):
            result = _call(
                server.read_blocks,
                block_id=["7", "p1_b2", "missing"],
                workspace_id="workspace",
            )

        resolve.assert_called_once_with(ANY, workspace_id="workspace", defer=True)
        read.assert_called_once_with(ANY, ["7", "p1_b2", "missing"], [10, 20])
        self.assertEqual([item.get("block_id") for item in result], [7, 8, "missing"])
        self.assertEqual(result[-1]["error"], "Block not found")

    def test_section_and_block_readers_expose_batched_id_schemas(self):
        section_schema = server.read_sections.parameters["properties"]["section_id"]
        block_schema = server.read_blocks.parameters["properties"]["block_id"]

        for schema in (section_schema, block_schema):
            types = {entry.get("type") for entry in schema["anyOf"]}
            self.assertLessEqual({"string", "array", "null"}, types)
        self.assertNotIn("section_id", server.read_blocks.parameters["properties"])

    def test_expand_context_resolves_sections_across_workspace(self):
        context = {
            "target_section_id": 42,
            "document_id": "resolved.pdf",
            "workspace_id": "workspace",
            "ancestors": [],
            "descendants": [],
        }
        with (
            patch.object(server, "_resolve_document_id", return_value=[10, 20]) as resolve,
            patch.object(server, "expand_section_context", return_value=context),
        ):
            result = _call(
                server.expand_context,
                section_id="42",
                workspace_id="workspace",
            )

        resolve.assert_called_once_with(ANY, workspace_id="workspace", defer=True)
        self.assertEqual(result["document_id"], "resolved.pdf")

    def test_expand_context_includes_target_and_descendant_content(self):
        from src.mcp_server.context_navigation import Hierarchy
        target = SimpleNamespace(id=42, section_id="target")
        ancestor = SimpleNamespace(id=7, section_id="ancestor")
        descendant = SimpleNamespace(id=43, section_id="descendant")
        hierarchy = Hierarchy([
            {"id": 7, "section_id": "ancestor", "title": "Parent"},
            {"id": 42, "section_id": "target", "title": "Target", "parent_section_id": "7"},
            {"id": 43, "section_id": "descendant", "title": "Child", "parent_section_id": "42"},
        ])
        document = SimpleNamespace(id="doc-1", file_name="resolved.pdf", workspace_id="workspace")
        payloads = {sid: {"blocks": [{"block_id": sid, "content": content}]}
                    for sid, content in [(7, "applicability"), (42, "target text"), (43, "continuation")]}
        with (
            patch.object(db_helpers, "_resolve_section", return_value=(target, "doc")),
            patch.object(db_helpers, "get_document_by_internal_id", return_value=document),
            patch("src.mcp_server.context_navigation.load_hierarchy", return_value=hierarchy),
            patch.object(db_helpers, "_get_sections_by_ids", return_value=[ancestor, target, descendant]),
            patch.object(db_helpers, "_section_content_batch", return_value=payloads) as batch,
        ):
            result = db_helpers.expand_section_context(object(), "42", ["doc"])
        self.assertEqual([section.id for section in batch.call_args.args[3]], [7, 42, 43])
        for content in ("applicability", "target text", "continuation"):
            self.assertIn(content, result["content"])
        self.assertNotIn("blocks", result)


class MultiWorkspaceAuthorizationTests(unittest.TestCase):
    def test_workspace_header_authorizes_requested_subset(self):
        token = server.set_request_workspace_ids(["workspace-a", "workspace-b"])
        try:
            server._require_search_scope(["workspace-a", "workspace-b"])
            with self.assertRaisesRegex(ValueError, "workspace-c"):
                server._require_search_scope(["workspace-a", "workspace-c"])
        finally:
            server.clear_request_workspace_ids(token)

    def test_workspace_header_normalizes_repeated_and_comma_separated_values(self):
        token = server.set_request_workspace_ids(["workspace-a, workspace-b", "workspace-a"])
        try:
            self.assertEqual(
                server._get_request_workspace_ids(),
                ["workspace-a", "workspace-b"],
            )
        finally:
            server.clear_request_workspace_ids(token)


if __name__ == "__main__":
    unittest.main()

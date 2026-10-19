import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from src.mcp_server import logical_indexing_server as server


class ToolArgumentFormatTests(unittest.TestCase):
    def test_reported_scalar_exclusion_fails_but_array_reaches_search(self):
        arguments = {
            "workspace_id": "6aa81362ee4a3f09f3c0ef49",
            "query": "ACTIVISIONBLIZZARD_2019_10K.pdf Total net revenues 2019 and 2018",
            "top_k": 10,
            "include_hierarchy": True,
            "exclude_section_ids": "97996",
        }
        with patch.object(server, "_require_search_scope"), patch.object(
            server, "_prepare_hybrid_search", AsyncMock(return_value=([.1], {}))
        ) as prepare, patch.object(
            server, "_run_unified_search", AsyncMock(return_value=[])
        ) as retrieve:
            with self.assertRaisesRegex(Exception, "valid list"):
                asyncio.run(server.search.run(arguments))
            prepare.assert_not_awaited()
            arguments["exclude_section_ids"] = [97996]
            asyncio.run(server.search.run(arguments))
            self.assertEqual(retrieve.await_args.kwargs["exclude_section_ids"], [97996])

    def test_reported_malformed_citation_string_fails_but_array_reaches_locators(self):
        citations = [{
            "type": "text", "block_id": "441661", "reference": 1,
            "evidence_text": "We made capital expenditures of $116 million in 2019, "
                             "as compared to $131 million in 2018.",
        }]
        for tool, helper in (
            (server.locate_answer_citations, "locate_answer_citation_positions"),
            (server.locate_answer_citations_mistral, "locate_answer_citation_positions_mistral"),
        ):
            with self.subTest(tool=tool.name), patch.object(
                server, "_require_search_scope"
            ), patch.object(
                server, "_run_db", AsyncMock(side_effect=lambda operation, **kwargs: operation(None))
            ) as run_db, patch.object(server, helper, return_value={"citations": []}) as locate:
                with self.assertRaisesRegex(Exception, "valid list"):
                    asyncio.run(tool.run({
                        "workspace_id": "6aa81362ee4a3f09f3c0ef49",
                        "citations": '[{"type":"text","block_id":"441661","reference":1}]}',
                    }))
                run_db.assert_not_awaited()
                asyncio.run(tool.run({
                    "workspace_id": "6aa81362ee4a3f09f3c0ef49", "citations": citations,
                }))
                self.assertEqual(locate.call_args.kwargs["citations"][0]["block_id"], "441661")
                self.assertEqual(locate.call_args.kwargs["citations"][0]["evidence_text"],
                                 citations[0]["evidence_text"])

    def test_published_schema_keeps_arrays_and_explains_native_values(self):
        for tool, argument in (
            (server.search, "exclude_section_ids"),
            (server.locate_answer_citations, "citations"),
            (server.locate_answer_citations_mistral, "citations"),
        ):
            schema = tool.parameters["properties"][argument]
            self.assertIn("array", {option.get("type") for option in schema["anyOf"]})
            self.assertIn("JSON array", schema["description"])


if __name__ == "__main__":
    unittest.main()

import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from src.mcp_server import db_helpers as db
from src.mcp_server import logical_indexing_server as server


def metadata(document="a", alias="p1_b1", content="The limit is 10."):
    return {"document_id": document, "section_id": "s", "page_number": 1,
            "source": document + ".pdf", "block_bbox": [0, 0, 10, 10],
            "position_block_id": alias, "external_block_id": alias,
            "block_text": content}


def position(document, content, identity=1, alias="p1_b1"):
    return SimpleNamespace(id=identity, document_id=document, section_id="s",
                           block_id=alias, page_number=1,
                           words=[{"text": word, "bbox": [0, 0, 1, 1]}
                                  for word in content.split()])


class CitationIntegrityTests(unittest.TestCase):
    def test_empty_evidence_cites_textless_image_and_full_description(self):
        image = {"image_id": "img", "document_id": "a", "source": "a.pdf",
                 "page_number": 3, "bbox": [20, 40, 220, 140], "words": [], "content": ""}
        with patch.object(db.settings, "IMAGE_BBOX_DPI", 144):
            result = db._image_citation_result({"reference": 1, "evidence_text": ""}, image)
            self.assertEqual(result["highlight_text"], "")
            self.assertEqual(result["highlight_bbox"], [10, 20, 100, 50])
            self.assertEqual(result["image_id"], "img")
            self.assertEqual(result["page_number"], 3)
            image.update(content="A red bird on a branch.")
            result = db._image_citation_result({"reference": 1, "evidence_text": ""}, image)
            self.assertEqual(result["highlight_text"], image["content"])
            self.assertEqual(result["highlight_bbox"], [10, 20, 100, 50])

    def test_empty_evidence_uses_whole_bbox_in_mixed_standard_batch(self):
        citations = [
            {"type": "text", "block_id": "102", "reference": 1, "evidence_text": ""},
            {"type": "text", "block_id": "101", "reference": 2, "evidence_text": "The limit is 10."},
            {"type": "image", "image_id": "img", "reference": 3, "evidence_text": ""},
            {"type": "text", "block_id": "missing", "reference": 4, "evidence_text": ""},
        ]
        image = {"image_id": "img", "document_id": "a", "source": "a.pdf",
                 "page_number": 3, "bbox": [20, 40, 220, 140], "words": [], "content": ""}
        with patch.object(db, "_get_block_metadata_batch", return_value={
            "101": metadata(), "102": metadata(content="Full block. More text.")}), patch.object(
            db, "_get_image_citation_metadata_batch", return_value={"img": image}), patch.object(
            db, "_get_candidate_text_positions_batch", return_value={"101": [(position("a", "The limit is 10."), "a.pdf")]}) as positions:
            result = db.locate_answer_citation_positions(None, citations, None, "ws")
        self.assertEqual(positions.call_args.args[1], ["101"])
        self.assertEqual([item["reference"] for item in result["citations"]], ["[1]", "[2]", "[3]"])
        self.assertEqual(result["citations"][0]["highlight_text"], "Full block. More text.")
        self.assertEqual(result["citations"][0]["highlight_bbox"], db._xyxy_pixels_to_pdf_xywh([0, 0, 10, 10], db.settings.IMAGE_BBOX_DPI))
        self.assertEqual(result["citations"][2]["highlight_text"], "")

    def test_mistral_empty_evidence_cites_textless_image_block(self):
        with patch.object(db, "_get_block_metadata_batch", return_value={"101": metadata(content="")}), patch.object(
            db.settings, "MISTRAL_BBOX_DPI", 72):
            result = db.locate_answer_citation_positions_mistral(None, [
                {"type": "image", "image_id": "101", "reference": 1, "evidence_text": ""},
                {"type": "image", "image_id": "missing", "reference": 2, "evidence_text": ""},
            ], None, "ws")
        self.assertEqual(len(result["citations"]), 1)
        self.assertEqual(result["citations"][0]["highlight_text"], "")
        self.assertEqual(result["citations"][0]["highlight_bbox"], [0, 0, 10, 10])

    def test_both_tools_accept_empty_evidence_but_reject_missing_or_null(self):
        async def run(operation, deadline):
            return operation(None)

        with patch.object(server, "_require_search_scope"), patch.object(server, "_run_db", side_effect=run), patch.object(
            db, "_get_block_metadata_batch", return_value={"101": metadata()}), patch.object(
            db, "_get_image_citation_metadata_batch", return_value={}):
            for tool in (server.locate_answer_citations, server.locate_answer_citations_mistral):
                citation = {"type": "text", "block_id": "101", "reference": 1, "evidence_text": ""}
                result = json.loads(asyncio.run(tool.run({"workspace_id": "ws", "citations": [citation]})).content[0].text)
                self.assertEqual(result["citations"][0]["highlight_text"], "The limit is 10.")
                for invalid in ({key: value for key, value in citation.items() if key != "evidence_text"},
                                {**citation, "evidence_text": None}):
                    result = json.loads(asyncio.run(tool.run({"workspace_id": "ws", "citations": [invalid]})).content[0].text)
                    self.assertEqual(result["error"], "Invalid citation arguments.")
                    self.assertIn("evidence_text", result["citation_errors"][0]["missing_fields"])

    def test_mistral_rejects_invented_evidence_and_preserves_source_whitespace(self):
        with patch.object(db, "_get_block_metadata_batch", return_value={
            "101": metadata(content="The limit\nis 10.")
        }):
            result = db.locate_answer_citation_positions_mistral(None, [
                {"type": "text", "block_id": "101", "reference": 1,
                 "evidence_text": "The limit is 999."},
                {"type": "text", "block_id": "101", "reference": 2,
                 "evidence_text": "The limit is 10."},
            ], None, "ws")
        self.assertEqual(len(result["citations"]), 1)
        self.assertEqual(result["citations"][0]["reference"], "[2]")
        self.assertEqual(result["citations"][0]["highlight_text"], "The limit\nis 10.")

    def test_evidence_validation_keeps_numbers_signs_and_negation(self):
        for source, evidence in [
            ("The limit is not 10.", "The limit is 10."),
            ("The limit is 100.", "The limit is 10"),
            ("The limit is -10.", "10"),
            ("The limit is 10.5.", "10"),
            ("The limit is 10.5.", "5"),
        ]:
            with self.subTest(source=source, evidence=evidence):
                self.assertIsNone(db._block_bbox_citation_result(
                    {"evidence_text": evidence, "reference": 1}, "101",
                    metadata(content=source)))

    def test_image_requires_evidence_in_description_or_ocr(self):
        image = {"image_id": "img", "document_id": "a", "source": "a.pdf",
                 "page_number": 1, "bbox": [0, 0, 10, 10], "words": [],
                 "content": "Revenue increased 10%."}
        self.assertIsNone(db._image_citation_result(
            {"reference": 1, "evidence_text": "Revenue increased 99%."}, image))
        supported = db._image_citation_result(
            {"reference": 1, "evidence_text": "Revenue increased 10%."}, image)
        self.assertEqual(supported["highlight_text"], "Revenue increased 10%.")
        image.update(content="", words=position("a", "Revenue increased 10%.").words)
        self.assertIsNotNone(db._image_citation_result(
            {"reference": 1, "evidence_text": "Revenue increased 10%."}, image))

    def test_ambiguous_alias_and_internal_external_collision_are_not_resolved(self):
        session = Mock()
        session.execute.return_value.all.return_value = [
            (101, "a", "s", 1, "a.pdf", "a.pdf", None, "p1_b1", "A"),
            (202, "b", "s", 1, "b.pdf", "b.pdf", None, "p1_b1", "B"),
            (303, "c", "s", 1, "c.pdf", "c.pdf", None, "101", "C"),
        ]
        result = db._get_block_metadata_batch(session, ["101", "202", "p1_b1"],
                                             None, "ws", None)
        self.assertEqual(set(result), {"202"})

    def test_position_aliases_are_document_scoped_and_deduplicated(self):
        session = Mock()
        session.execute.return_value.all.return_value = [
            (position("a", "A"), "a.pdf"),
            (position("b", "B", 2), "b.pdf"),
        ]
        result = db._get_candidate_text_positions_batch(
            session, ["101"], None, "ws", None, {"101": metadata()})
        self.assertEqual([(p.document_id, p.id) for p, _ in result["101"]], [("a", 1)])
        statement = str(session.execute.call_args.args[0])
        self.assertIn("logical_text_positions.document_id", statement.split("WHERE")[1])

    def test_unknown_block_cannot_resolve_an_orphan_position(self):
        session = Mock()
        result = db._get_candidate_text_positions_batch(
            session, ["missing"], None, "ws", None, {})
        self.assertEqual(result, {})
        session.execute.assert_not_called()

    def test_standard_locator_rejects_wrong_document_and_unsupported_block_text(self):
        session = Mock()
        session.execute.return_value.all.return_value = [
            (position("a", "The limit is 10."), "a.pdf"),
            (position("b", "The limit is 999.", 2), "b.pdf"),
        ]
        with patch.object(db, "_get_block_metadata_batch", return_value={"101": metadata()}), \
             patch.object(db, "_get_image_citation_metadata_batch", return_value={}):
            result = db.locate_answer_citation_positions(session, [
                {"type": "text", "block_id": "101", "reference": 1,
                 "evidence_text": "The limit is 999."},
                {"type": "text", "block_id": "101", "reference": 2,
                 "evidence_text": "The limit is 10."},
            ], None, "ws")
        self.assertEqual(len(result["citations"]), 1)
        self.assertEqual(result["citations"][0]["source"], "a.pdf")
        self.assertEqual(result["citations"][0]["reference"], "[2]")

    def test_standard_locator_does_not_turn_fuzzy_number_match_into_citation(self):
        records = db._word_records(position("a", "The limit is 999.").words)
        result, _ = db._locate_single_citation(
            {"block_id": "101", "block_text": "The limit is 10.",
             "evidence_text": "The limit is 10.", "reference": 1},
            [{"records": records, "match_index": db._build_position_match_index(records),
              "document_id": "a", "section_id": "s", "page_number": 1,
              "source": "a.pdf"}])
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()

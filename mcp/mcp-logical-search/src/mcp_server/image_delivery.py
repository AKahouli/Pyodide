"""Attach stored image payloads only to evidence retained in a tool response."""
import json
import re

from sqlalchemy import and_, select

from src.config.settings import get_settings
from src.db.models import LogicalBlock, LogicalDocument, LogicalImage
from src.db.session import check_db_deadline
from src.mcp_server.db_helpers import _apply_document_filters, _serialize_image, bounded_image_options
from src.mcp_server.section_search import _same_image


def image_evidence_targets(response):
    targets = []

    def collect(value):
        if isinstance(value, dict):
            if "content" in value and "error" not in value:
                if value.get("image_id") is not None or (
                    value.get("block_id") is not None and (
                        str(value.get("block_type", "")).startswith("image/")
                        or value.get("block_type") in ("image", "figure", "chart"))):
                    targets.append(value)
                # Context pages encode evidence identities in source-order markers.
                if "context_version" in value or "contexts" in value:
                    images = []
                    for marker in re.findall(r'^\[image (\{[^\n]*\})\]', value.get("content", ""), re.MULTILINE):
                        try:
                            images.append(json.loads(marker))
                        except ValueError:
                            continue
                    if images:
                        value["images"] = images
                        targets.extend(images)
            for key, item in list(value.items()):
                if key != "images" or not ("context_version" in value or "contexts" in value):
                    collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    collect(response)
    return targets


def attach_evidence_images(session, response, workspace_id):
    targets = image_evidence_targets(response)
    if not targets:
        return response
    image_ids = {str(item["image_id"]) for item in targets if item.get("image_id") is not None}
    block_ids = {int(item["block_id"]) for item in targets
                 if item.get("image_id") is None and str(item.get("block_id", "")).isdecimal()}
    linked = {}
    if block_ids:
        stmt = select(LogicalBlock.id, LogicalImage.id.label("image_id")).join(
            LogicalImage, and_(*_same_image(LogicalBlock, LogicalImage))).join(
            LogicalDocument, LogicalDocument.id == LogicalBlock.document_id).where(LogicalBlock.id.in_(block_ids))
        for row in session.execute(_apply_document_filters(stmt, workspace_id=workspace_id)).all():
            linked.setdefault(row.id, row.image_id)
        image_ids.update(linked.values())
    if not image_ids:
        for item in targets:
            item["image_status"] = "not_found"
        return response
    stmt = select(LogicalImage).options(*bounded_image_options()).join(LogicalDocument).where(LogicalImage.id.in_(image_ids))
    images = {str(image.id): image for image in session.execute(
        _apply_document_filters(stmt, workspace_id=workspace_id)).scalars().all()}
    remaining = get_settings().READ_CONTENT_BATCH_MAX_BYTES
    payloads = {}
    for item in targets:
        check_db_deadline()
        image_id = item.get("image_id") or linked.get(int(item.get("block_id", 0)))
        image_id = str(image_id) if image_id is not None else None
        if image_id not in images:
            item["image_status"] = "not_found"
            continue
        item["image_id"] = image_id
        if image_id not in payloads:
            raw = _serialize_image(images[image_id])["image_base64"]
            if not raw:
                payloads[image_id] = ("unavailable", None)
            elif len(raw.encode("utf-8")) > remaining:
                payloads[image_id] = ("omitted_byte_budget", None)
            else:
                remaining -= len(raw.encode("utf-8"))
                payloads[image_id] = ("returned", raw)
        status, raw = payloads[image_id]
        item["image_status"] = status
        if raw:
            item["image_base64"] = raw
        elif status == "omitted_byte_budget":
            item["image_next_action"] = "Read the containing section with read_sections(include_images=true)."
    return response

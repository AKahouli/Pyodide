"""Orchestrates download → probe → extract for one attachment profile."""

import asyncio
import os
from datetime import datetime, timezone

from src.smart_rag.tools.infrastructure.common_helpers import CommonHelpers

from . import extractors, probe
from .models import AttachmentProfile, AttachmentProfileRequest, ExtractionInfo, TabularInfo

TABULAR_EXTENSIONS = {".csv", ".xls", ".xlsx"}


class AttachmentProfileService:
    def __init__(self, helpers: CommonHelpers = None):
        self.helpers = helpers or CommonHelpers()

    async def build_profile(self, request: AttachmentProfileRequest) -> AttachmentProfile:
        local_path = await self.helpers.async_download_from_storage(request.path)
        try:
            extension = extractors.extension_of(request.filename) or ""
            # Extraction/ probing is synchronous CPU/IO work: keep it off the
            # event loop so gRPC streaming is never blocked by a large file.
            return await asyncio.to_thread(self._build_sync, request, local_path, extension)
        finally:
            try:
                os.remove(local_path)
            except OSError:
                pass

    def _build_sync(
        self,
        request: AttachmentProfileRequest,
        local_path: str,
        extension: str,
    ) -> AttachmentProfile:
        if extension in TABULAR_EXTENSIONS:
            return self._profile_tabular(request, local_path, extension)
        return self._profile_document(request, local_path, extension)

    def _profile_tabular(
        self, request: AttachmentProfileRequest, local_path: str, extension: str
    ) -> AttachmentProfile:
        try:
            if extension == ".csv":
                with open(local_path, "r", newline="", encoding="utf-8-sig", errors="replace") as file_obj:
                    total_rows, column_names, exceeded = probe.probe_csv(file_obj, request.max_indexed_tabular_rows)
                sheet_count = None
            elif extension == ".xlsx":
                total_rows, column_names, sheet_count, exceeded = probe.probe_xlsx(
                    local_path, request.max_indexed_tabular_rows
                )
            else:
                total_rows, column_names, sheet_count, exceeded = probe.probe_xls(
                    local_path, request.max_indexed_tabular_rows
                )
        except Exception as exc:
            # Fail closed: an unprovable row count means the backend must
            # treat this file as CODE_ONLY and never index it.
            return self._failed_profile(request, local_path, extension, f"tabular probe failed: {exc}")

        sample_text = ""
        if extension == ".csv":
            sample_text, _, _ = extractors._extract_csv(local_path)
        elif extension == ".xlsx":
            sample_text, _, _ = extractors._extract_xlsx(local_path)

        return AttachmentProfile(
            document_id=request.document_id,
            filename=request.filename,
            mime_type=request.mime_type,
            extraction=ExtractionInfo(
                status="ready",
                extractor="tabular-probe",
                characters=len(sample_text),
                truncated=False,
            ),
            tabular=TabularInfo(
                total_rows=total_rows,
                sheet_count=sheet_count,
                column_names=(column_names or [])[:50] or None,
            ),
            content=None if exceeded else sample_text,
            preview=None if exceeded else (sample_text[:500] if sample_text else None),
            generated_at=_utc_now(),
        )

    def _profile_document(
        self, request: AttachmentProfileRequest, local_path: str, extension: str
    ) -> AttachmentProfile:
        try:
            text, extractor, truncated = extractors.extract_text(local_path, extension)
        except Exception as exc:
            return self._failed_profile(request, local_path, extension, str(exc))
        return AttachmentProfile(
            document_id=request.document_id,
            filename=request.filename,
            mime_type=request.mime_type,
            extraction=ExtractionInfo(
                status="partial" if truncated else "ready",
                extractor=extractor,
                characters=len(text),
                truncated=truncated,
            ),
            tabular=None,
            content=text or None,
            preview=(text[:500] if text else None),
            generated_at=_utc_now(),
        )

    def _failed_profile(
        self, request: AttachmentProfileRequest, local_path: str, extension: str, reason: str
    ) -> AttachmentProfile:
        return AttachmentProfile(
            document_id=request.document_id,
            filename=request.filename,
            mime_type=request.mime_type,
            extraction=ExtractionInfo(
                status="failed",
                extractor=extension.lstrip(".") or "unknown",
                characters=0,
                truncated=False,
            ),
            tabular=None,
            content=None,
            preview=f"extraction failed: {reason}",
            generated_at=_utc_now(),
        )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


attachment_profile_service = AttachmentProfileService()

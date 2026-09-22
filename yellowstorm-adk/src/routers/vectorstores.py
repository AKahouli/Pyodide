"""Attachment profiling endpoints.

Lightweight text-only probing for Conversation attachments: download the
stored file, extract bounded plain text, count tabular rows with an
early-stop threshold, and return the profile. Never indexes anything.

Authenticated like every other data-reaching router: the endpoint downloads
arbitrary storage objects, so it must never be exposed without the
x-api-key check.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from src.authentification.get_current_user import get_current_active_user
from src.modules.attachment_profile.models import AttachmentProfile, AttachmentProfileRequest
from src.modules.attachment_profile.service import attachment_profile_service
from src.schema.authentification_schema import User

router = APIRouter(tags=["vectorstores"])


@router.post("/vectorstores/attachmentProfile", response_model=AttachmentProfile)
async def attachment_profile(
    request: AttachmentProfileRequest,
    _current_user: Annotated[User, Depends(get_current_active_user)],
) -> AttachmentProfile:
    return await attachment_profile_service.build_profile(request)

"""Generate a conversation image through the authenticated platform boundary."""

import base64
import math
import re
from urllib.parse import urlsplit
from typing import Any, Literal

import httpx
from google.adk.tools import ToolContext

IMAGE_SANDBOX_INPUTS_STATE_KEY = "_image_sandbox_inputs"
MAX_IMAGE_SANDBOX_INPUTS = 32


def _valid_image_source(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value) > 2048 or any(ord(c) < 32 for c in value):
        return False
    if value.startswith("generated-image:"):
        return bool(re.fullmatch(r"generated-image:[a-f0-9]{24}", value))
    if value.startswith("https://"):
        try:
            parsed = urlsplit(value)
            return bool(parsed.hostname and not parsed.username and not parsed.password)
        except ValueError:
            return False
    return not any(c in value for c in "/\\:") and bool(re.search(r"\.(png|jpe?g|webp|pdf)$", value, re.I))


def _render_source_pdf(encoded: str, page_number: int) -> str:
    """Render only the authorized PDF page; bytes and internal paths never reach the model."""
    import pymupdf

    if not isinstance(encoded, str) or len(encoded) > 28 * 1024 * 1024:
        raise ValueError("Invalid PDF input")
    data = base64.b64decode(encoded, validate=True)
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("PDF exceeds size limit")
    with pymupdf.open(stream=data, filetype="pdf") as document:
        if document.needs_pass or not 1 <= page_number <= min(document.page_count, 5000):
            raise ValueError("PDF page unavailable")
        page = document.load_page(page_number - 1)
        longest = max(page.rect.width, page.rect.height)
        if not math.isfinite(longest) or longest <= 0:
            raise ValueError("Invalid PDF dimensions")
        scale = min(2, 1400 / longest)
        image = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB,
                                alpha=False, annots=False).tobytes("png")
    if len(image) > 6 * 1024 * 1024:
        raise ValueError("Rendered image exceeds size limit")
    return base64.b64encode(image).decode("ascii")


def create_generate_image_tool(runtime_context: dict[str, Any] | None = None):
    ctx = runtime_context or {}
    api_url = str(ctx.get("platform_api_url") or "").rstrip("/")
    token = str(ctx.get("platform_api_token") or "")
    conversation_id = str(ctx.get("conversation_id") or "")
    user_id = str(ctx.get("user_id") or "")
    agent_id = str(ctx.get("agent_id") or "")
    model = str(ctx.get("image_generation_model") or "gpt-image-2.5-flare")
    if not all((api_url, token, conversation_id, user_id, agent_id)):
        return None
    if api_url.endswith("/api"):
        api_url += "/v1"
    elif not api_url.endswith("/api/v1"):
        api_url += "/api/v1"

    async def generate_image(
        prompt: str = "", aspectRatio: Literal["square", "landscape", "portrait"] = "square",
        sourceImage: str | None = None,
        reuseImage: str | None = None,
        sourcePage: int = 1,
        tool_context: ToolContext = None,
    ) -> dict[str, Any]:
        """Generate an image, edit with sourceImage and prompt, or import/reuse without generation using reuseImage. Sources can be exact generated-image:<id> references, public HTTPS image URLs returned by web search, or exact filenames of uploaded images/PDFs in this conversation or its selected workspaces. Never use storage paths or invent URLs. For a PDF use sourcePage (1-based, default 1); the selected page is rendered as the source image. Do not combine sourceImage and reuseImage. Edits preserve the original and return a new image. For DOCX or editable PPTX, use the authoritative sandboxPath directly in Code Interpreter shell_exec with python-docx/python-pptx after sandbox_create. Copy sandboxPath verbatim: never add a system_<conversation> folder or rewrite it from storage keys or mount metadata. Never discover or guess paths; call reuseImage to recover a previous image path after reload. Keep document text/shapes editable. Use imageSource exactly in OpenUI Image/slide or Markdown image. Label AI generated only when generated is true; imported originals are not AI generated. Images persist after reload."""
        if sourceImage is not None and reuseImage is not None:
            return {"status": "error", "detail": "Choose either image editing or reuse."}
        if not isinstance(prompt, str) or len(prompt) > 12000 or (reuseImage is None and not prompt.strip()):
            return {"status": "error", "detail": "Provide an image prompt between 1 and 12000 characters."}
        if aspectRatio not in {"square", "landscape", "portrait"}:
            return {"status": "error", "detail": "Choose square, landscape, or portrait."}
        if isinstance(sourcePage, bool) or not isinstance(sourcePage, int) or not 1 <= sourcePage <= 5000:
            return {"status": "error", "detail": "Choose a PDF page between 1 and 5000."}
        for reference in (sourceImage, reuseImage):
            if reference is not None and not _valid_image_source(reference):
                return {"status": "error", "detail": "Use a saved image reference, public HTTPS image URL, or exact uploaded filename."}
        payload = {"conversationId": conversation_id, "userId": user_id,
                   "agentId": agent_id, "model": model, "prompt": prompt.strip(),
                   "aspectRatio": aspectRatio}
        if sourceImage is not None:
            payload["sourceImage"] = sourceImage
        if reuseImage is not None:
            payload["reuseImage"] = reuseImage
        if sourcePage != 1:
            payload["sourcePage"] = sourcePage
        try:
            async with httpx.AsyncClient(timeout=210.0) as client:
                response = await client.post(
                    f"{api_url}/internal/root-work/images/generate",
                    headers={"X-Internal-Token": token},
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
                data = body.get("data", body) if isinstance(body, dict) else None
                if isinstance(data, dict) and "sourcePdf" in data:
                    payload["preparedImage"] = _render_source_pdf(data["sourcePdf"], sourcePage)
                    response = await client.post(f"{api_url}/internal/root-work/images/generate",
                        headers={"X-Internal-Token": token}, json=payload)
                    response.raise_for_status()
                    body = response.json()
                    data = body.get("data", body) if isinstance(body, dict) else None
            if not isinstance(data, dict) or not re.fullmatch(
                r"generated-image:[a-f0-9]{24}", str(data.get("imageSource") or "")
            ):
                return {"status": "error", "detail": "Image generation returned an invalid image receipt."}
            receipt = {"imageSource": data["imageSource"], "fileName": str(data.get("fileName") or "generated-image.png"),
                       "mimeType": str(data.get("mimeType") or "image/png"), "generated": data.get("generated") is not False}
            if re.fullmatch(r"generated-image:[a-f0-9]{24}", str(data.get("originalImageSource") or "")):
                receipt["originalImageSource"] = data["originalImageSource"]
            sandbox_path = str(data.get("sandboxPath") or "")
            image_id = data["imageSource"].split(":", 1)[1]
            if sandbox_path and re.fullmatch(
                rf"/mnt/workspace/generated-images/{image_id}\.(png|jpg|webp)", sandbox_path
            ):
                receipt["sandboxPath"] = sandbox_path
                if tool_context is not None:
                    invocation = getattr(tool_context, "invocation_id", "") or ""
                    previous = tool_context.state.get(IMAGE_SANDBOX_INPUTS_STATE_KEY, {})
                    paths = previous.get("paths", []) if isinstance(previous, dict) and previous.get("invocation") == invocation else []
                    paths = list(dict.fromkeys([*paths, sandbox_path]))
                    if len(paths) > MAX_IMAGE_SANDBOX_INPUTS:
                        return {"status": "error", "detail": "Too many image inputs in one turn; use at most 32."}
                    tool_context.state[IMAGE_SANDBOX_INPUTS_STATE_KEY] = {
                        "invocation": invocation, "paths": paths,
                    }
            return receipt
        except (httpx.HTTPError, ValueError, RuntimeError):
            return {"status": "error", "detail": "Image generation failed. Please try again."}

    from src.root_runtime.leaf_tools import register_tool_execution_kind
    return register_tool_execution_kind(generate_image, "leaf")

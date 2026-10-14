"""Generate a conversation image through the authenticated platform boundary."""

import re
from typing import Any, Literal

import httpx


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
    ) -> dict[str, Any]:
        """Generate an image, edit with sourceImage and prompt, or reuse an existing image without generation using reuseImage. For sourceImage/reuseImage use the exact generated-image:<id> reference from conversation history. Do not combine them. Edits preserve the original and return a new image. For DOCX or editable PPTX, use the returned authoritative sandboxPath directly in Code Interpreter shell_exec with python-docx or python-pptx, after sandbox_create. Never discover or guess image paths; call reuseImage to obtain a path for a previous image, including after reload. Keep document text and shapes editable. Use imageSource exactly in OpenUI Image/slide or Markdown image, label AI generated. Never invent references. Images persist after reload."""
        if sourceImage is not None and reuseImage is not None:
            return {"status": "error", "detail": "Choose either image editing or reuse."}
        if not isinstance(prompt, str) or len(prompt) > 12000 or (reuseImage is None and not prompt.strip()):
            return {"status": "error", "detail": "Provide an image prompt between 1 and 12000 characters."}
        if aspectRatio not in {"square", "landscape", "portrait"}:
            return {"status": "error", "detail": "Choose square, landscape, or portrait."}
        for reference in (sourceImage, reuseImage):
            if reference is not None and (not isinstance(reference, str)
                    or not re.fullmatch(r"generated-image:[a-f0-9]{24}", reference)):
                return {"status": "error", "detail": "Use an existing generated-image reference."}
        payload = {"conversationId": conversation_id, "userId": user_id,
                   "agentId": agent_id, "model": model, "prompt": prompt.strip(),
                   "aspectRatio": aspectRatio}
        if sourceImage is not None:
            payload["sourceImage"] = sourceImage
        if reuseImage is not None:
            payload["reuseImage"] = reuseImage
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
            if not isinstance(data, dict) or not re.fullmatch(
                r"generated-image:[a-f0-9]{24}", str(data.get("imageSource") or "")
            ):
                return {"status": "error", "detail": "Image generation returned an invalid image receipt."}
            receipt = {"imageSource": data["imageSource"], "fileName": str(data.get("fileName") or "generated-image.png"),
                       "mimeType": str(data.get("mimeType") or "image/png"), "generated": True}
            sandbox_path = str(data.get("sandboxPath") or "")
            image_id = data["imageSource"].split(":", 1)[1]
            if sandbox_path and re.fullmatch(
                rf"/mnt/workspace/generated-images/{image_id}\.(png|jpg|webp)", sandbox_path
            ):
                receipt["sandboxPath"] = sandbox_path
            return receipt
        except (httpx.HTTPError, ValueError):
            return {"status": "error", "detail": "Image generation failed. Please try again."}

    from src.root_runtime.leaf_tools import register_tool_execution_kind
    return register_tool_execution_kind(generate_image, "leaf")

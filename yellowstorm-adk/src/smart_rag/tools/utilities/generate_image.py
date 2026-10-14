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
        prompt: str, aspectRatio: Literal["square", "landscape", "portrait"] = "square",
        sourceImage: str | None = None,
    ) -> dict[str, Any]:
        """Generate an original image, or edit an existing generated image. For edits, pass its exact generated-image:<id> imageSource from conversation history as sourceImage and describe the changes in prompt. Every edit returns a new image receipt and preserves the original. Use the returned imageSource exactly in an OpenUI Image or slide image, or as a Markdown image URL. Label it AI generated. Never invent image references. Images remain available after reload."""
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 12000:
            return {"status": "error", "detail": "Provide an image prompt between 1 and 12000 characters."}
        if aspectRatio not in {"square", "landscape", "portrait"}:
            return {"status": "error", "detail": "Choose square, landscape, or portrait."}
        if sourceImage is not None and (
            not isinstance(sourceImage, str)
            or not re.fullmatch(r"generated-image:[a-f0-9]{24}", sourceImage)
        ):
            return {"status": "error", "detail": "Use an existing generated-image reference as sourceImage."}
        payload = {"conversationId": conversation_id, "userId": user_id,
                   "agentId": agent_id, "model": model, "prompt": prompt.strip(),
                   "aspectRatio": aspectRatio}
        if sourceImage is not None:
            payload["sourceImage"] = sourceImage
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
            return {"imageSource": data["imageSource"], "fileName": str(data.get("fileName") or "generated-image.png"),
                    "mimeType": str(data.get("mimeType") or "image/png"), "generated": True}
        except (httpx.HTTPError, ValueError):
            return {"status": "error", "detail": "Image generation failed. Please try again."}

    from src.root_runtime.leaf_tools import register_tool_execution_kind
    return register_tool_execution_kind(generate_image, "leaf")

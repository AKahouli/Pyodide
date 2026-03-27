import asyncio
import json

from typing import List,Dict, Any


from src.logger.logging import get_logger
from src.smart_rag.engines.multi_agent.config import SYSTEM_AGENT_NAME, NO_STREAMING_MESSAGE_TYPE, \
    SUGGESTIONS_CONTENT_TYPE, ERROR_MESSAGE_TYPE

logger = get_logger("api.routers.agentic_rag.MessageHelper")

class MessageHelper:

    @staticmethod
    async def _send_suggestions(q: asyncio.Queue[dict], session_id: str, suggestions: List[Dict[str, Any]]) -> None:
        """Send agent suggestions to the queue."""
        try:
            logger.info(f"[MESSAGE HELPER] Sending {len(suggestions)} suggestions to backend - session_id: {session_id}")
            await q.put({
                "agent_name": SYSTEM_AGENT_NAME,
                "agent_type": SUGGESTIONS_CONTENT_TYPE,
                "chunk": json.dumps(suggestions),
                "message_id": session_id,
                "message_type": NO_STREAMING_MESSAGE_TYPE,
                "content_type": SUGGESTIONS_CONTENT_TYPE
            })
        except Exception as e:
            logger.error(f"Failed to send suggestions: {str(e)}")

    @staticmethod
    async def _send_error_message(q: asyncio.Queue[dict], session_id: str, error_msg: str, title: str = None) -> None:
        """Send error message as an error component to the queue."""
        try:
            import uuid

            # Use provided title or default to "Error"
            if not title:
                title = "Error"

            logger.error(f"[MESSAGE HELPER] Sending error component to backend - session_id: {session_id}, title: {title}")

            # Send error as an error component
            error_component = {
                "action": "add",
                "component": {
                    "id": str(uuid.uuid4()),
                    "type": "error",
                    "data": {
                        "title": title,
                        "content": error_msg
                    }
                },
                "metadata": {
                    "message_id": session_id
                }
            }

            await q.put(error_component)

            logger.info(f"[MESSAGE HELPER] Sending stream end (None) to backend after error - session_id: {session_id}")
            await q.put(None)
        except Exception as e:
            logger.error(f"Failed to send error message: {str(e)}")
from typing import Any

from langchain_core.messages import BaseMessage


def messages_to_trace_prompt(messages: list[BaseMessage]) -> str:
    return "\n\n".join(f"[{message.type}] {message.content}" for message in messages)


def notify_trace(context: Any) -> None:
    if context.on_trace_update is not None:
        context.on_trace_update()

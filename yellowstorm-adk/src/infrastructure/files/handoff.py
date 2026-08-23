from typing import Any, Protocol

from src.infrastructure.files.resolved_file import ResolvedFile


class ResolvedFileConsumer(Protocol):
    async def consume(self, file: ResolvedFile, *, context: dict[str, Any]) -> Any: ...


class FileHandoffService:
    """Routes safe logical files without exposing consumer storage identifiers."""

    def __init__(self) -> None:
        self._consumers: dict[str, ResolvedFileConsumer] = {}

    def register(self, capability: str, consumer: ResolvedFileConsumer) -> None:
        name = capability.strip()
        if not name or name in self._consumers:
            raise ValueError("file handoff capability must be unique")
        self._consumers[name] = consumer

    async def handoff(
        self,
        capability: str,
        file: ResolvedFile,
        *,
        context: dict[str, Any] | None = None,
    ) -> Any:
        consumer = self._consumers.get(capability)
        if consumer is None:
            raise ValueError(f"unknown file handoff capability: {capability}")
        return await consumer.consume(file, context=dict(context or {}))

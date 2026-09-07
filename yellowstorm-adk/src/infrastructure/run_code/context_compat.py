import re

from src.infrastructure.run_code.source_descriptor import RunCodeSourceDescriptor


def legacy_prefixes_to_sources(source_prefixes: list[str] | None) -> list[RunCodeSourceDescriptor]:
    sources: list[RunCodeSourceDescriptor] = []
    used: set[str] = set()
    seen: set[str] = set()
    for index, raw_prefix in enumerate(source_prefixes or []):
        prefix = str(raw_prefix or "").strip().strip("/")
        if not prefix or prefix in seen or "/" not in prefix:
            continue
        seen.add(prefix)
        base = re.sub(r"[^a-z0-9]+", "-", prefix.rsplit("/", 1)[-1].lower()).strip("-")[:64] or "source"
        alias = base
        suffix = 2
        while alias in used:
            tail = f"-{suffix}"
            alias = f"{base[:64 - len(tail)]}{tail}"
            suffix += 1
        used.add(alias)
        sources.append(RunCodeSourceDescriptor(
            workspaceId=f"legacy-{index}",
            alias=alias,
            cephPrefix=prefix,
            scope={"kind": "workspace"},
        ))
    return sources

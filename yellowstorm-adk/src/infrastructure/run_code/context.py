import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.run_workspace import run_workspace_path
from src.infrastructure.run_code.source_descriptor import RunCodeSourceDescriptor


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_ALIAS_PART = re.compile(r"[^a-z0-9]+")


class RunCodeMount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    virtualPath: str
    cephPrefix: str
    mode: Literal["r", "rw"]
    allowedRelativePaths: list[str] | None = None


class RunCodeContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    userId: str
    runId: str
    mounts: list[RunCodeMount] = Field(min_length=1, max_length=20)
    sources: list[RunCodeSourceDescriptor] = Field(default_factory=list, exclude=True)

    @field_validator("userId", "runId")
    @classmethod
    def validate_identifier(cls, value: str) -> str:
        if not _IDENTIFIER.fullmatch(value or ""):
            raise ValueError("invalid run-code identifier")
        return value

    @model_validator(mode="after")
    def validate_writable_mount(self) -> "RunCodeContext":
        expected = run_workspace_path(self.userId, self.runId)
        writable = [mount for mount in self.mounts if mount.mode == "rw"]
        if (
            len(writable) != 1
            or writable[0].virtualPath != "/workspace/run"
            or writable[0].cephPrefix != expected
        ):
            raise ValueError("invalid writable run-code mount")
        return self


def alias_for_source(display_name: str, workspace_id: str, used: set[str]) -> str:
    raw = display_name.lower()
    base = _ALIAS_PART.sub("-", raw).strip("-")[:64] or "source"
    if not base[0].isalnum():
        base = f"source-{base}"[:64]
    alias = base
    if alias in used:
        compact_id = _ALIAS_PART.sub("", workspace_id.lower())[-4:] or "source"
        tail = f"-{compact_id}"
        alias = f"{base[:64 - len(tail)]}{tail}"
        suffix = 2
        while alias in used:
            tail = f"-{compact_id}-{suffix}"
            alias = f"{base[:64 - len(tail)]}{tail}"
            suffix += 1
    used.add(alias)
    return alias


def build_run_code_context(
    user_id: str,
    run_id: str,
    source_prefixes: list[str] | None = None,
) -> RunCodeContext:
    from src.infrastructure.run_code.context_compat import legacy_prefixes_to_sources

    return build_run_code_context_from_sources(
        user_id,
        run_id,
        legacy_prefixes_to_sources(source_prefixes),
    )


def build_run_code_context_from_sources(
    user_id: str,
    run_id: str,
    sources: list[RunCodeSourceDescriptor | dict] | None = None,
) -> RunCodeContext:
    run_prefix = run_workspace_path(user_id, run_id)
    if not run_prefix:
        raise ValueError("run_code requires a user and canonical run ID")

    mounts: list[RunCodeMount] = [
        RunCodeMount(
            virtualPath="/workspace/run",
            cephPrefix=run_prefix,
            mode="rw",
        )
    ]
    validated_sources = [RunCodeSourceDescriptor.model_validate(source) for source in sources or []]
    used_aliases: set[str] = set()
    seen_prefixes = {run_prefix}
    accepted_sources: list[RunCodeSourceDescriptor] = []
    for source in validated_sources:
        prefix = source.cephPrefix
        identity = (prefix, source.scope.kind, tuple(getattr(source.scope, "relativePaths", [])))
        if prefix in seen_prefixes and source.scope.kind == "workspace":
            continue
        alias = alias_for_source(source.alias, source.workspaceId, used_aliases)
        source = source.model_copy(update={"alias": alias})
        if source.scope.kind == "workspace":
            seen_prefixes.add(prefix)
        accepted_sources.append(source)
        mounts.append(
            RunCodeMount(
                virtualPath=f"/workspace/{'sources' if source.scope.kind == 'workspace' else 'attachments'}/{alias}",
                cephPrefix=prefix,
                mode="r",
                allowedRelativePaths=(
                    source.scope.relativePaths if source.scope.kind == "files" else None
                ),
            )
        )
        del identity
    return RunCodeContext(userId=user_id, runId=run_id, mounts=mounts, sources=accepted_sources)


def parse_run_code_context(runtime_context: dict[str, Any]) -> RunCodeContext | None:
    raw = runtime_context.get("run_code_context_json")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        value = json.loads(raw)
        if isinstance(value, dict) and isinstance(value.get("sources"), list):
            return build_run_code_context_from_sources(
                str(value.get("userId") or ""),
                str(value.get("runId") or ""),
                value["sources"],
            )
        if isinstance(value, dict) and isinstance(value.get("sourcePrefixes"), list):
            return build_run_code_context(
                str(value.get("userId") or ""),
                str(value.get("runId") or ""),
                [str(item) for item in value["sourcePrefixes"]],
            )
        return RunCodeContext.model_validate(value)
    except (ValueError, TypeError, json.JSONDecodeError):
        return None

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.run_workspace import run_workspace_path


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_ALIAS_PART = re.compile(r"[^a-z0-9]+")


class RunCodeMount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    virtualPath: str
    cephPrefix: str
    mode: Literal["r", "rw"]


class RunCodeContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    userId: str
    runId: str
    mounts: list[RunCodeMount] = Field(min_length=1, max_length=20)

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


def _alias_for_prefix(prefix: str, used: set[str]) -> str:
    raw = prefix.strip("/").rsplit("/", 1)[-1].lower()
    base = _ALIAS_PART.sub("-", raw).strip("-")[:64] or "source"
    if not base[0].isalnum():
        base = f"source-{base}"[:64]
    alias = base
    suffix = 2
    while alias in used:
        tail = f"-{suffix}"
        alias = f"{base[:64 - len(tail)]}{tail}"
        suffix += 1
    used.add(alias)
    return alias


def build_run_code_context(
    user_id: str,
    run_id: str,
    source_prefixes: list[str] | None = None,
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
    used_aliases: set[str] = set()
    seen_prefixes = {run_prefix}
    for raw_prefix in source_prefixes or []:
        prefix = str(raw_prefix or "").strip().strip("/")
        if (
            not prefix
            or prefix in seen_prefixes
            or "/" not in prefix
            or any(part in ("", ".", "..") for part in prefix.split("/"))
        ):
            continue
        seen_prefixes.add(prefix)
        alias = _alias_for_prefix(prefix, used_aliases)
        mounts.append(
            RunCodeMount(
                virtualPath=f"/workspace/sources/{alias}",
                cephPrefix=prefix,
                mode="r",
            )
        )
    return RunCodeContext(userId=user_id, runId=run_id, mounts=mounts)


def parse_run_code_context(runtime_context: dict[str, Any]) -> RunCodeContext | None:
    raw = runtime_context.get("run_code_context_json")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        value = json.loads(raw)
        if isinstance(value, dict) and isinstance(value.get("sourcePrefixes"), list):
            return build_run_code_context(
                str(value.get("userId") or ""),
                str(value.get("runId") or ""),
                [str(item) for item in value["sourcePrefixes"]],
            )
        return RunCodeContext.model_validate(value)
    except (ValueError, TypeError, json.JSONDecodeError):
        return None

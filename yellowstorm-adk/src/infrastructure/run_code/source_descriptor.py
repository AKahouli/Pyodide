import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


_ALIAS = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


class WorkspaceSourceScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["workspace"]


class FileSourceScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["files"]
    relativePaths: list[str] = Field(min_length=1)

    @field_validator("relativePaths")
    @classmethod
    def validate_paths(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            path = value.strip().strip("/")
            if not path or any(part in ("", ".", "..") for part in path.split("/")):
                raise ValueError("invalid authorized relative path")
            normalized.append(path)
        return sorted(set(normalized))


RunCodeSourceScope = Annotated[
    WorkspaceSourceScope | FileSourceScope,
    Field(discriminator="kind"),
]


class RunCodeSourceDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspaceId: str = Field(min_length=1)
    alias: str
    cephPrefix: str = Field(min_length=3)
    scope: RunCodeSourceScope

    @field_validator("alias")
    @classmethod
    def validate_alias(cls, value: str) -> str:
        if not _ALIAS.fullmatch(value):
            raise ValueError("invalid source alias")
        return value

    @field_validator("cephPrefix")
    @classmethod
    def validate_prefix(cls, value: str) -> str:
        prefix = value.strip().strip("/")
        if "/" not in prefix or any(part in ("", ".", "..") for part in prefix.split("/")):
            raise ValueError("invalid source prefix")
        return prefix

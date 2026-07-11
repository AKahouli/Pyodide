from typing import Any, Literal, Optional

from google.adk.tools.tool_context import ToolContext
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


ChoicePresentation = Literal["quick_replies", "list"]
ChoiceSelectionMode = Literal["single", "multiple"]
ChoiceSubmitBehavior = Literal["immediate", "explicit"]


class ChoiceOptionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    label: str = Field(min_length=1, max_length=160)
    submitText: str = Field(min_length=1, max_length=1000)
    value: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    disabled: bool = False

    @field_validator("id", "label", "submitText", "value", "description", mode="before")
    @classmethod
    def trim_strings(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class ChoiceOtherOptionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    label: str = Field(min_length=1, max_length=160)
    placeholder: Optional[str] = Field(default=None, max_length=500)
    maxLength: int = Field(default=500, ge=1, le=2000)


class ChoiceProgressInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current: int = Field(ge=1)
    total: int = Field(ge=1)
    label: Optional[str] = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def validate_total(self) -> "ChoiceProgressInput":
        if self.total < self.current:
            raise ValueError("progress.total must be greater than or equal to progress.current")
        return self


class ChoiceLabelsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submit: Optional[str] = Field(default=None, max_length=100)
    dismiss: Optional[str] = Field(default=None, max_length=100)
    other: Optional[str] = Field(default=None, max_length=100)


class PresentChoicesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questionId: str = Field(min_length=1, max_length=100)
    prompt: str = Field(min_length=1, max_length=500)
    options: list[ChoiceOptionInput] = Field(min_length=2, max_length=10)
    presentation: ChoicePresentation = "quick_replies"
    selectionMode: ChoiceSelectionMode = "single"
    submitBehavior: Optional[ChoiceSubmitBehavior] = None
    description: Optional[str] = Field(default=None, max_length=1500)
    otherOption: Optional[ChoiceOtherOptionInput] = None
    labels: Optional[ChoiceLabelsInput] = None
    progress: Optional[ChoiceProgressInput] = None
    dismissible: bool = False
    fallbackText: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("questionId", "prompt", "description", "fallbackText", mode="before")
    @classmethod
    def trim_strings(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def normalize(self) -> "PresentChoicesInput":
        if len({option.id for option in self.options}) != len(self.options):
            raise ValueError("options must have unique ids")
        if self.selectionMode == "multiple" or (self.otherOption and self.otherOption.enabled):
            self.submitBehavior = "explicit"
        elif self.submitBehavior is None:
            self.submitBehavior = "explicit" if self.presentation == "list" else "immediate"
        return self


def _validation_details(error: ValidationError) -> list[dict[str, str]]:
    return [
        {
            "location": ".".join(str(part) for part in item["loc"]),
            "message": str(item["msg"]),
        }
        for item in error.errors()
    ]


async def present_choices(
    questionId: str,
    prompt: str,
    options: list[dict[str, Any]],
    presentation: ChoicePresentation = "quick_replies",
    selectionMode: ChoiceSelectionMode = "single",
    submitBehavior: Optional[ChoiceSubmitBehavior] = None,
    description: Optional[str] = None,
    otherOption: Optional[dict[str, Any]] = None,
    labels: Optional[dict[str, str]] = None,
    progress: Optional[dict[str, Any]] = None,
    dismissible: bool = False,
    fallbackText: Optional[str] = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Present a structured question with answers the user can select.

    Use quick_replies for two to five short, mutually exclusive answers that can
    be submitted immediately. Use list when answers need descriptions, multiple
    selection, another-answer input, or explicit confirmation. Multiple selection
    and another-answer input always require explicit submission. Do not use this
    for informational Markdown lists. Ground every option in the conversation and
    give every option a stable id, concise label, and autonomous submitText.
    """
    try:
        payload = PresentChoicesInput.model_validate(
            {
                "questionId": questionId,
                "prompt": prompt,
                "options": options,
                "presentation": presentation,
                "selectionMode": selectionMode,
                "submitBehavior": submitBehavior,
                "description": description,
                "otherOption": otherOption,
                "labels": labels,
                "progress": progress,
                "dismissible": dismissible,
                "fallbackText": fallbackText,
            }
        )
    except ValidationError as exc:
        return {"error": "invalid_choice_payload", "details": _validation_details(exc)}

    data = payload.model_dump(exclude_none=True)
    data["schemaVersion"] = 1
    data["status"] = "ready"
    return data

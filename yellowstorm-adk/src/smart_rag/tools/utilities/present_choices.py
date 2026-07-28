import json
import re
from urllib.parse import urlparse
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
    submitText: str = Field(
        min_length=1,
        max_length=1000,
        description="Imperative, standalone action for the agent. Include the option's intent and necessary context; do not repeat only the visible label.",
    )
    value: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    disabled: bool = False
    url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("id", "label", "submitText", "value", "description", mode="before")
    @classmethod
    def trim_strings(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("url")
    @classmethod
    def validate_https_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        parsed = urlparse(value.strip())
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("url must be an absolute HTTPS URL without credentials")
        return value.strip()


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

    @model_validator(mode="before")
    @classmethod
    def normalize_tool_call_artifacts(cls, data: Any) -> Any:
        if not isinstance(data, dict) or not isinstance(data.get("options"), list):
            return data

        options: list[Any] = []
        for option in data["options"]:
            # Some tool-call transports serialize nested objects into a $text
            # envelope. Accept only a JSON object, leaving malformed input for
            # normal Pydantic validation rather than guessing its structure.
            if isinstance(option, dict) and set(option) == {"$text"} and isinstance(option["$text"], str):
                try:
                    decoded = json.loads(option["$text"].strip())
                except json.JSONDecodeError:
                    decoded = option
                option = decoded if isinstance(decoded, dict) else option
            if isinstance(option, dict) and "submit_text" in option and "submitText" not in option:
                option = {**option, "submitText": option["submit_text"]}
                del option["submit_text"]
            options.append(option)

        normalized_data = {**data, "options": options}
        # Optional objects emitted as {} are transport noise, not a request for
        # an invalid progress/labels object.
        for field in ("progress", "labels", "otherOption"):
            if normalized_data.get(field) == {}:
                normalized_data.pop(field)

        valid_ids = {
            option["id"].strip()
            for option in options
            if isinstance(option, dict)
            and isinstance(option.get("id"), str)
            and re.fullmatch(r"[A-Za-z0-9._-]+", option["id"].strip())
            and option["id"].strip()
        }
        used_ids = set(valid_ids)
        normalized_options: list[Any] = []
        for index, option in enumerate(options, start=1):
            if not isinstance(option, dict):
                normalized_options.append(option)
                continue
            candidate_id = option.get("id")
            if isinstance(candidate_id, str) and re.fullmatch(r"[A-Za-z0-9._-]+", candidate_id.strip()) and candidate_id.strip():
                normalized_options.append(option)
                continue
            source = candidate_id if isinstance(candidate_id, str) else option.get("label")
            base = re.sub(r"[^A-Za-z0-9._-]+", "-", source.strip()).strip("._-") if isinstance(source, str) else ""
            base = (base or f"option-{index}")[:64]
            option_id = base
            suffix = 2
            while option_id in used_ids:
                suffix_text = f"-{suffix}"
                option_id = f"{base[:64 - len(suffix_text)]}{suffix_text}"
                suffix += 1
            used_ids.add(option_id)
            normalized_options.append({**option, "id": option_id})
        return {**normalized_data, "options": normalized_options}

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
    options: list[ChoiceOptionInput],
    presentation: ChoicePresentation = "quick_replies",
    selectionMode: ChoiceSelectionMode = "single",
    submitBehavior: Optional[ChoiceSubmitBehavior] = None,
    description: Optional[str] = None,
    otherOption: Optional[ChoiceOtherOptionInput] = None,
    labels: Optional[ChoiceLabelsInput] = None,
    progress: Optional[ChoiceProgressInput] = None,
    dismissible: bool = False,
    fallbackText: Optional[str] = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Present structured choices with actionable submitText values and optional free-text otherOption."""
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
    if tool_context:
        tool_context.actions.skip_summarization = True
    return data

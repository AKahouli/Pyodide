import pytest
from pydantic import ValidationError

from src.smart_rag.tools.utilities.present_choices import PresentChoicesInput


def payload(options):
    return {"questionId": "next-action", "prompt": "What should we do?", "options": options}


def option(option_id: str, label: str = "Option"):
    return {"id": option_id, "label": label, "submitText": label}


def test_preserves_valid_option_ids():
    result = PresentChoicesInput.model_validate(payload([option("report_issue"), option("contact-agent")]))

    assert [item.id for item in result.options] == ["report_issue", "contact-agent"]


def test_normalizes_invalid_option_ids_and_resolves_collisions():
    result = PresentChoicesInput.model_validate(payload([
        option("Report an issue!"),
        option("Report an issue?"),
    ]))

    assert [item.id for item in result.options] == ["Report-an-issue", "Report-an-issue-2"]


def test_keeps_duplicate_valid_option_ids_as_validation_errors():
    with pytest.raises(ValidationError, match="unique ids"):
        PresentChoicesInput.model_validate(payload([option("same"), option("same", "Other")]))


def test_does_not_repair_unrelated_invalid_option_fields():
    with pytest.raises(ValidationError):
        PresentChoicesInput.model_validate(payload([
            {"id": "invalid id", "label": "Option"},
            option("other"),
        ]))

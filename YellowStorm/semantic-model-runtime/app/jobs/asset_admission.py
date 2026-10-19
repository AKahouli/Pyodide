"""Canonical admission candidate handling, NOT a signature verifier.

The backend verifies the signature, exact UUID, creation window and scope on
every asset grant/use. Parsing here only constrains persistence: one candidate
UUID cannot become multiple jobs, and a signed snapshot cannot execute a
different normalized command. Possession of a candidate grants no asset access.
"""
from __future__ import annotations

import base64
import json
import time
from uuid import UUID

from .models import IdempotencyConflict, JobCommand

OPERATIONAL_FIELDS = {"assetAdmission", "assetCommand"}


def without_asset_authority(dump: dict) -> dict:
    payload = dump.get("payload")
    if not isinstance(payload, dict) or not any(field in payload for field in OPERATIONAL_FIELDS):
        # Nothing to strip: return the input unchanged so callers that did not
        # carry asset authority keep the original object identity.
        return dump
    return {**dump, "payload": {k: v for k, v in payload.items() if k not in OPERATIONAL_FIELDS}}


def admission_candidate(command: JobCommand, key: str | None = None) -> str | None:
    dump = command.model_dump(by_alias=True, mode="json")
    payload = dump["payload"]
    token = payload.get("assetAdmission")
    if token is None:
        return None  # Non-asset jobs remain compatible; backend asset access fails closed.
    try:
        if not isinstance(token, str) or len(token) > 512000:
            raise ValueError()
        header, encoded, signature = token.split(".")
        if not header or not signature:
            raise ValueError()
        body = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))["body"]
        nonce = str(UUID(body["nonce"]))
        if nonce != body["nonce"] or (key is not None and body["key"] != key):
            raise ValueError()
        iat, exp = body["iat"], body["exp"]
        if type(iat) is not int or type(exp) is not int or not 0 < exp - iat <= 300 or not iat <= time.time() <= exp:
            raise ValueError()
        original = body["command"]
        if payload.get("assetCommand") != original:
            raise ValueError()
        parsed = type(command).model_validate(json.loads(original))
        if without_asset_authority(parsed.model_dump(by_alias=True, mode="json")) != without_asset_authority(dump):
            raise ValueError()
        expected_purpose = "population" if type(command).__name__ == "PopulationCommand" else "discovery"
        if body["purpose"] != expected_purpose or body["actor"] != command.actor_user_id or body["model"] != command.model_id:
            raise ValueError()
        return nonce
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        raise IdempotencyConflict("invalid canonical asset admission") from exc

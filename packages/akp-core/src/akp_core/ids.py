"""Prefixed, URL-safe identifiers (Stripe-style: ``org_...``, ``usr_...``)."""

from __future__ import annotations

import secrets
import string
from enum import StrEnum

_ALPHABET = string.digits + string.ascii_letters
_ID_LENGTH = 24


class IdPrefix(StrEnum):
    organization = "org"
    user = "usr"
    membership = "mem"
    session = "ses"
    api_key = "key"
    document = "doc"
    chunk = "chk"
    data_source = "src"
    conversation = "cnv"
    message = "msg"
    citation = "cit"
    audit_log = "aud"
    ingestion_job = "job"
    evaluation = "evl"
    evaluation_result = "evr"
    invite_token = "inv"
    usage_event = "use"
    webhook_endpoint = "whk"
    webhook_delivery = "whd"
    message_feedback = "fbk"
    idempotency_key = "idm"
    team = "tem"
    team_membership = "tmm"
    collection = "col"
    collection_document = "cdoc"
    prompt_template = "prm"
    stored_object = "obj"
    document_acl = "acl"
    document_version = "dver"
    sso_connection = "sso"
    scim_token = "scm"
    subscription = "sub"
    budget_period = "bud"
    tool_invocation = "tol"


def new_id(prefix: IdPrefix | str) -> str:
    """Generate a new prefixed id, e.g. ``usr_a1B2...``."""
    random_part = "".join(secrets.choice(_ALPHABET) for _ in range(_ID_LENGTH))
    return f"{prefix}_{random_part}"


def is_id(value: object, prefix: IdPrefix | str) -> bool:
    if not isinstance(value, str):
        return False
    expected = f"{prefix}_"
    return value.startswith(expected) and len(value) > len(expected)

"""Unit tests for error envelope and ID helpers."""

from akp_core import ErrorCode, NotFoundError, ValidationError, new_id
from akp_core.ids import IdPrefix


def test_new_id_prefix() -> None:
    value = new_id(IdPrefix.user)
    assert value.startswith("usr_")
    assert len(value) == len("usr_") + 24


def test_validation_error_envelope_shape() -> None:
    err = ValidationError("Request validation failed", [{"path": "/email", "message": "Required"}])
    serialized = err.to_serialized()
    assert serialized.code == ErrorCode.VALIDATION_ERROR
    assert serialized.status_code == 422
    assert serialized.details == [{"path": "/email", "message": "Required"}]


def test_not_found_message() -> None:
    err = NotFoundError("Route")
    assert err.message == "Route not found"
    assert err.status_code == 404

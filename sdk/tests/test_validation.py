import pytest

from agent_integrations.pft_tasknode.sdk.validation import (
    validate_cid,
    validate_non_negative_int,
    validate_nonempty_content,
    validate_url,
    validate_xrp_address,
    ValidationError,
)


def test_validate_nonempty_content():
    validate_nonempty_content(b"hi")
    with pytest.raises(ValidationError):
        validate_nonempty_content(b"")


def test_validate_cid():
    validate_cid("bafkreiTESTCID1234567890")
    with pytest.raises(ValidationError):
        validate_cid("")


def test_validate_xrp_address():
    validate_xrp_address("r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59")
    with pytest.raises(ValidationError):
        validate_xrp_address("not_an_address")


def test_validate_non_negative_int():
    validate_non_negative_int(0, "schema")
    with pytest.raises(ValidationError):
        validate_non_negative_int(-1, "schema")


def test_validate_url():
    validate_url("http://127.0.0.1:5001")
    with pytest.raises(ValidationError):
        validate_url("ftp://example.com")

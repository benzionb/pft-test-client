"""Pointer memo encoding for PFT Ledger transactions.

Observed memo payload format (binary, protobuf-like):
  \n;bafkrei...\\x10\\x01\\x18\\x06 \\x01@\\x01

Field mapping (observed, not fully verified):
  1 (string)  -> CID
  2 (varint)  -> schema version (default 1)
  3 (varint)  -> pointer kind (TASK_SUBMISSION = 6)
  4 (varint)  -> flags (default 1)
  8 (varint)  -> unknown (default 1)
"""

from __future__ import annotations

from typing import Optional

from .validation import validate_cid, validate_non_negative_int, ValidationError


POINTER_KIND = {
    "TASK_SUBMISSION": 6,
}


def _encode_varint(value: int) -> bytes:
    """Encode an integer as protobuf varint."""
    if value < 0:
        raise ValueError("varint cannot be negative")
    out = bytearray()
    while True:
        to_write = value & 0x7F
        value >>= 7
        if value:
            out.append(to_write | 0x80)
        else:
            out.append(to_write)
            break
    return bytes(out)


def _encode_key(field_number: int, wire_type: int) -> bytes:
    """Encode a protobuf field key."""
    return _encode_varint((field_number << 3) | wire_type)


def _encode_string(field_number: int, value: str) -> bytes:
    encoded = value.encode("utf-8")
    return _encode_key(field_number, 2) + _encode_varint(len(encoded)) + encoded


def _encode_varint_field(field_number: int, value: int) -> bytes:
    return _encode_key(field_number, 0) + _encode_varint(value)


def encode_pointer_memo(
    cid: str,
    kind: str = "TASK_SUBMISSION",
    schema: int = 1,
    flags: int = 1,
    unknown8: Optional[int] = 1,
) -> bytes:
    """Encode a pointer memo payload.

    This produces the memo payload (not hex/base64) that is placed in MemoData.
    """
    if kind not in POINTER_KIND:
        raise ValueError(f"Unknown pointer kind: {kind}")
    try:
        validate_cid(cid)
        validate_non_negative_int(schema, "schema")
        validate_non_negative_int(flags, "flags")
        if unknown8 is not None:
            validate_non_negative_int(unknown8, "unknown8")
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc
    payload = bytearray()
    payload += _encode_string(1, cid)
    payload += _encode_varint_field(2, schema)
    payload += _encode_varint_field(3, POINTER_KIND[kind])
    payload += _encode_varint_field(4, flags)
    if unknown8 is not None:
        payload += _encode_varint_field(8, unknown8)
    return bytes(payload)

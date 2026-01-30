"""Validation helpers for PFT Task Node SDK."""

from __future__ import annotations

import re


CID_PREFIXES = ("bafk", "bafy")
MAX_INT32 = 2**31 - 1


class ValidationError(ValueError):
    """Raised when inputs fail validation."""


def validate_nonempty_content(content: bytes) -> None:
    if not isinstance(content, (bytes, bytearray)) or len(content) == 0:
        raise ValidationError("content must be non-empty bytes")


def validate_cid(cid: str) -> None:
    if not isinstance(cid, str) or not cid:
        raise ValidationError("cid must be a non-empty string")
    if not cid.startswith(CID_PREFIXES) or len(cid) < 20:
        raise ValidationError(f"cid has unexpected format: {cid}")


def validate_xrp_address(address: str) -> None:
    if not isinstance(address, str) or not address:
        raise ValidationError("address must be a non-empty string")
    if not re.fullmatch(r"r[1-9A-HJ-NP-Za-km-z]{24,34}", address):
        raise ValidationError(f"invalid XRP address format: {address}")


def validate_non_negative_int(value: int, name: str) -> None:
    if not isinstance(value, int) or value < 0:
        raise ValidationError(f"{name} must be a non-negative integer")
    if value > MAX_INT32:
        raise ValidationError(f"{name} must be <= {MAX_INT32}")


def validate_url(url: str) -> None:
    if not isinstance(url, str) or not url:
        raise ValidationError("url must be a non-empty string")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValidationError(f"url must start with http:// or https://: {url}")

"""XRP transaction builder for pointer submissions."""

from __future__ import annotations

from typing import Dict

from .pointer import encode_pointer_memo
from .validation import (
    validate_cid,
    validate_non_negative_int,
    validate_xrp_address,
    ValidationError,
)


DEFAULT_DESTINATION = "rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7"
DEFAULT_MEMO_TYPE = "pf.ptr"
DEFAULT_AMOUNT_DROPS = "1"
MAX_MEMO_BYTES = 1024


def build_pointer_transaction(
    account: str,
    cid: str,
    kind: str = "TASK_SUBMISSION",
    destination: str = DEFAULT_DESTINATION,
    schema: int = 1,
    flags: int = 1,
    amount_drops: str = DEFAULT_AMOUNT_DROPS,
) -> Dict[str, object]:
    """Build an XRP Payment transaction with a pointer memo."""
    try:
        validate_xrp_address(account)
        validate_xrp_address(destination)
        validate_cid(cid)
        validate_non_negative_int(schema, "schema")
        validate_non_negative_int(flags, "flags")
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc

    memo_payload = encode_pointer_memo(cid, kind=kind, schema=schema, flags=flags)
    if not amount_drops.isdigit() or int(amount_drops) <= 0:
        raise ValueError("amount_drops must be a positive integer string")
    if len(memo_payload) > MAX_MEMO_BYTES:
        raise ValueError(f"MemoData too large: {len(memo_payload)} bytes (max {MAX_MEMO_BYTES})")

    return {
        "TransactionType": "Payment",
        "Account": account,
        "Destination": destination,
        "Amount": amount_drops,
        "Memos": [
            {
                "Memo": {
                    "MemoType": DEFAULT_MEMO_TYPE.encode("utf-8").hex(),
                    "MemoData": memo_payload.hex(),
                }
            }
        ],
    }

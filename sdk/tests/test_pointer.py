import binascii

from sdk.pointer import encode_pointer_memo


def test_encode_pointer_memo_bytes():
    cid = "bafkreiTESTCID1234567890"
    memo = encode_pointer_memo(cid, kind="TASK_SUBMISSION", schema=1, flags=1, unknown8=1)
    # Expected structure: [field 1 string][field 2 varint][field 3 varint][field 4 varint][field 8 varint]
    assert memo.startswith(b"\n")
    assert b"bafkreiTESTCID1234567890" in memo
    # Quick length sanity check
    assert len(memo) < 100


def test_encode_pointer_memo_hex():
    cid = "bafkreiTESTCID1234567890"
    memo = encode_pointer_memo(cid, kind="TASK_SUBMISSION")
    hex_str = binascii.hexlify(memo).decode("ascii")
    assert hex_str

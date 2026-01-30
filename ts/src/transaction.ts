import { encodePointerMemo } from "./pointer.js";
import {
  validateCid,
  validateNonNegativeInt,
  validateXrpAddress,
  ValidationError,
} from "./validation.js";

export const DEFAULT_DESTINATION = "rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7";
export const DEFAULT_MEMO_TYPE = "pf.ptr";
export const DEFAULT_AMOUNT_DROPS = "1";
export const MAX_MEMO_BYTES = 1024;

export function buildPointerTransaction(
  account: string,
  cid: string,
  kind = "TASK_SUBMISSION",
  destination = DEFAULT_DESTINATION,
  schema = 1,
  flags = 1,
  amountDrops = DEFAULT_AMOUNT_DROPS
) {
  try {
    validateXrpAddress(account);
    validateXrpAddress(destination);
    validateCid(cid);
    validateNonNegativeInt(schema, "schema");
    validateNonNegativeInt(flags, "flags");
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw err;
  }

  if (!/^\d+$/.test(amountDrops) || Number(amountDrops) <= 0) {
    throw new Error("amountDrops must be a positive integer string");
  }

  const memoPayload = encodePointerMemo(cid, kind, schema, flags);
  if (memoPayload.length > MAX_MEMO_BYTES) {
    throw new Error(`MemoData too large: ${memoPayload.length} bytes`);
  }

  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: amountDrops,
    Memos: [
      {
        Memo: {
          MemoType: Buffer.from(DEFAULT_MEMO_TYPE, "utf8").toString("hex"),
          MemoData: Buffer.from(memoPayload).toString("hex"),
        },
      },
    ],
  };
}

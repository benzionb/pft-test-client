import {
  validateCid,
  validateNonNegativeInt,
  ValidationError,
} from "./validation.js";

const POINTER_KIND: Record<string, number> = {
  TASK_SUBMISSION: 6,
};

function encodeVarint(value: number): Uint8Array {
  if (value < 0) throw new Error("varint cannot be negative");
  const bytes: number[] = [];
  let v = value;
  while (true) {
    const toWrite = v & 0x7f;
    v >>= 7;
    if (v) bytes.push(toWrite | 0x80);
    else {
      bytes.push(toWrite);
      break;
    }
  }
  return new Uint8Array(bytes);
}

function encodeKey(fieldNumber: number, wireType: number): Uint8Array {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeString(fieldNumber: number, value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return concat(
    encodeKey(fieldNumber, 2),
    encodeVarint(encoded.length),
    encoded
  );
}

function encodeVarintField(fieldNumber: number, value: number): Uint8Array {
  return concat(encodeKey(fieldNumber, 0), encodeVarint(value));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function encodePointerMemo(
  cid: string,
  kind = "TASK_SUBMISSION",
  schema = 1,
  flags = 1,
  unknown8: number | null = 1
): Uint8Array {
  if (!(kind in POINTER_KIND)) {
    throw new Error(`Unknown pointer kind: ${kind}`);
  }
  try {
    validateCid(cid);
    validateNonNegativeInt(schema, "schema");
    validateNonNegativeInt(flags, "flags");
    if (unknown8 !== null) validateNonNegativeInt(unknown8, "unknown8");
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw err;
  }

  const parts: Uint8Array[] = [];
  parts.push(encodeString(1, cid));
  parts.push(encodeVarintField(2, schema));
  parts.push(encodeVarintField(3, POINTER_KIND[kind]));
  parts.push(encodeVarintField(4, flags));
  if (unknown8 !== null) parts.push(encodeVarintField(8, unknown8));
  return concat(...parts);
}

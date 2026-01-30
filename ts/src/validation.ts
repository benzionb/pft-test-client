const CID_PREFIXES = ["bafk", "bafy"] as const;

export class ValidationError extends Error {}

export function validateNonEmptyBytes(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new ValidationError("payload must be non-empty bytes");
  }
}

export function validateCid(cid: string) {
  if (!cid || typeof cid !== "string") {
    throw new ValidationError("cid must be a non-empty string");
  }
  if (!CID_PREFIXES.some((p) => cid.startsWith(p)) || cid.length < 20) {
    throw new ValidationError(`cid has unexpected format: ${cid}`);
  }
}

export function validateXrpAddress(address: string) {
  if (!address || typeof address !== "string") {
    throw new ValidationError("address must be a non-empty string");
  }
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) {
    throw new ValidationError(`invalid XRP address format: ${address}`);
  }
}

export function validateNonNegativeInt(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${name} must be a non-negative integer`);
  }
  if (value > 2 ** 31 - 1) {
    throw new ValidationError(`${name} must be <= ${2 ** 31 - 1}`);
  }
}

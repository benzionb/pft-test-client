import { createHash } from "crypto";
import { validateNonEmptyBytes, ValidationError } from "./validation.js";

export class IPFSPinningError extends Error {}

export function hashPayload(payload: Uint8Array): string {
  validateNonEmptyBytes(payload);
  return createHash("sha256").update(payload).digest("hex");
}

export async function pinToIPFSWeb3Storage(
  payload: Uint8Array,
  apiToken: string,
  uploadUrl = "https://api.web3.storage/upload"
): Promise<{ cid: string; sha256: string }> {
  try {
    validateNonEmptyBytes(payload);
    if (!apiToken) throw new IPFSPinningError("web3.storage apiToken is required");
    const sha256 = hashPayload(payload);
    const body = Buffer.from(payload);
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new IPFSPinningError(`web3.storage upload failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { cid?: string };
    if (!data.cid) {
      throw new IPFSPinningError("web3.storage response missing cid");
    }
    return { cid: data.cid, sha256 };
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new IPFSPinningError(err.message);
    }
    if (err instanceof IPFSPinningError) throw err;
    throw new IPFSPinningError(`IPFS pinning failed: ${String(err)}`);
  }
}

import { describe, it, expect } from "vitest";
import { encodePointerMemo } from "../src/pointer.js";

describe("encodePointerMemo", () => {
  it("includes CID bytes and is non-empty", () => {
    const cid = "bafkreiTESTCID1234567890";
    const memo = encodePointerMemo(cid);
    expect(memo.length).toBeGreaterThan(10);
    expect(Buffer.from(memo).toString("utf8")).toContain("bafkreiTESTCID");
  });
});

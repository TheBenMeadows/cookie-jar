import { describe, expect, it } from "vitest";

import { buildMemo, decodeRequest, encodeRequest, MAX_REF_LENGTH } from "./request";
import {
  freshRef,
  REF_ALPHABET,
  REF_LENGTH,
  SHOWCASE_REF_PREFIX,
  showcaseRequest,
} from "./showcase";

describe("freshRef", () => {
  it("returns TAB- followed by REF_LENGTH characters from the reference alphabet", () => {
    const ref = freshRef();
    expect(ref.startsWith(SHOWCASE_REF_PREFIX)).toBe(true);
    expect(ref.length).toBe(SHOWCASE_REF_PREFIX.length + REF_LENGTH);
    const suffix = ref.slice(SHOWCASE_REF_PREFIX.length);
    for (const char of suffix) {
      expect(REF_ALPHABET.includes(char)).toBe(true);
    }
  });

  it("returns a deterministic string when supplied with an injected random function", () => {
    const testBytes = [0, 1, 31, 32, 255, 100, 7];
    const mockRandom = (bytes: Uint8Array): Uint8Array => {
      bytes.set(testBytes);
      return bytes;
    };
    const expectedSuffix = testBytes.map((b) => REF_ALPHABET[b % 32]).join("");
    const expected = `${SHOWCASE_REF_PREFIX}${expectedSuffix}`;
    expect(freshRef(mockRandom)).toBe(expected);
  });

  it("generates distinct references on consecutive calls", () => {
    const ref1 = freshRef();
    const ref2 = freshRef();
    expect(ref1).not.toBe(ref2);
  });

  it("produces references within the maximum allowed length and without pipe characters", () => {
    const ref = freshRef();
    expect(ref.length).toBeLessThanOrEqual(MAX_REF_LENGTH);
    expect(ref.includes("|")).toBe(false);
  });
});

describe("showcaseRequest", () => {
  it("round-trips through encoding and decoding without losing fields", () => {
    const req = showcaseRequest(freshRef());
    const encoded = encodeRequest(req);
    const decoded = decodeRequest(encoded);
    expect(decoded.to).toBe(req.to);
    expect(decoded.amount).toBe(req.amount);
    expect(decoded.mint).toBe(req.mint);
    expect(decoded.decimals).toBe(req.decimals);
    expect(decoded.symbol).toBe(req.symbol);
    expect(decoded.ref).toBe(req.ref);
    expect(decoded.label).toBe(req.label);
    expect(decoded.note).toBe(req.note);
  });

  it("builds a memo starting with the expected prefix and reference", () => {
    const req = showcaseRequest("TAB-000000");
    const memo = buildMemo(req);
    expect(memo.startsWith("cookiejar:1|TAB-000000|")).toBe(true);
  });
});

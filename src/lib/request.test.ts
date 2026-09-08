import { describe, expect, it } from "vitest";

import { displayAmount, groupDigits, isRounded, rawToUi, uiToRaw } from "./format";
import { usdToRaw, rawToUsd } from "./quote";
import {
  buildMemo,
  decodeRequest,
  encodeRequest,
  isOpenAmount,
  parseMemo,
  RequestError,
  tokenDecimals,
  validateRecipient,
} from "./request";
import { looksLikeName, nameError, normalizeName } from "./names";

const COOKIE_ADDRESS = "4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx";
const TRASHCOIN_MINT = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";

describe("amount conversion", () => {
  it("keeps precision that a double would lose", () => {
    expect(uiToRaw("1745522.677131187", 9)).toBe(1_745_522_677_131_187n);
    expect(rawToUi(1_745_522_677_131_187n, 9)).toBe("1745522.677131187");
  });

  it("refuses more decimal places than the token holds", () => {
    expect(() => uiToRaw("1.0000000001", 9)).toThrow(/decimal places/);
  });

  it("refuses text that is not a number", () => {
    expect(() => uiToRaw("1e9", 9)).toThrow();
    expect(() => uiToRaw("", 9)).toThrow();
  });

  it("groups only the integer part", () => {
    expect(groupDigits("273827.349709201")).toBe("273,827.349709201");
  });
});

describe("amounts as a person reads them", () => {
  const cook = (ui: string): bigint => uiToRaw(ui, 9);

  it("keeps every zero in a round number", () => {
    // The trailing-zero trim once ran on the whole string, which turned 25,000 into 25.
    expect(displayAmount(cook("25000"), 9)).toBe("25,000");
    expect(displayAmount(cook("1000"), 9)).toBe("1,000");
    expect(displayAmount(cook("50000"), 9)).toBe("50,000");
    expect(isRounded(cook("25000"), 9)).toBe(false);
  });

  it("cuts a dollar-quoted amount down to something readable", () => {
    expect(displayAmount(cook("273827.349709201"), 9)).toBe("273,827");
    expect(isRounded(cook("273827.349709201"), 9)).toBe(true);
  });

  it("keeps precision on small amounts, where every digit counts", () => {
    expect(displayAmount(cook("0.000005"), 9)).toBe("0.000005");
    expect(displayAmount(cook("1.23456789"), 9)).toBe("1.2346");
  });

  it("never changes the exact figure a transaction carries", () => {
    expect(rawToUi(cook("273827.349709201"), 9)).toBe("273827.349709201");
  });
});

describe("dollar quoting", () => {
  const COOK_PRICE = 0.00009129840365826916;

  it("turns dollars into base units and back", () => {
    const raw = usdToRaw("25.00", COOK_PRICE, 9);
    expect(rawToUsd(raw, COOK_PRICE, 9)).toBeCloseTo(25, 4);
  });

  it("refuses a token with no price", () => {
    expect(() => usdToRaw("25.00", 0, 9)).toThrow(/no price/);
  });
});

describe("names", () => {
  it("strips the suffix and the case", () => {
    expect(normalizeName("Baker.cook")).toBe("baker");
    expect(normalizeName("baker")).toBe("baker");
  });

  it("tells a name from an address", () => {
    expect(looksLikeName("baker.cook")).toBe(true);
    expect(looksLikeName("baker")).toBe(true);
    expect(looksLikeName(COOKIE_ADDRESS)).toBe(false);
  });

  it("rejects what the registry rejects", () => {
    expect(nameError("baker")).toBeNull();
    expect(nameError("Baker")).toMatch(/lowercase|a-z/);
    expect(nameError("-baker")).toMatch(/hyphen/);
    expect(nameError("")).toMatch(/empty/);
    expect(nameError("x".repeat(33))).toMatch(/longer/);
  });
});

describe("payment links", () => {
  it("round-trips every field", () => {
    const encoded = encodeRequest({
      to: "baker.cook",
      label: "Bakery Tab",
      note: "one dozen, sesame",
      amount: "0.5",
      mint: TRASHCOIN_MINT,
      decimals: 9,
      symbol: "TRASHCOIN",
      ref: "INV-0007",
    });
    const decoded = decodeRequest(encoded);
    expect(decoded).toEqual({
      to: "baker.cook",
      label: "Bakery Tab",
      note: "one dozen, sesame",
      amount: "0.5",
      mint: TRASHCOIN_MINT,
      decimals: 9,
      symbol: "TRASHCOIN",
      ref: "INV-0007",
    });
    expect(encodeRequest(decoded)).toBe(encoded);
  });

  it("survives text that is not ASCII", () => {
    const encoded = encodeRequest({ to: COOKIE_ADDRESS, note: "påskebrød — 12 stk" });
    expect(decodeRequest(encoded).note).toBe("påskebrød — 12 stk");
  });

  it("treats a request with no amount as a tip jar", () => {
    expect(isOpenAmount(decodeRequest(encodeRequest({ to: "baker.cook" })))).toBe(true);
    expect(isOpenAmount(decodeRequest(encodeRequest({ to: "baker.cook", amount: "1" })))).toBe(false);
  });

  it("refuses a request that fixes two amounts", () => {
    expect(() => encodeRequest({ to: "baker.cook", amount: "1", usd: "1" })).toThrow(RequestError);
  });

  it("refuses a token without its decimals", () => {
    expect(() => encodeRequest({ to: "baker.cook", mint: TRASHCOIN_MINT })).toThrow(/decimals/);
  });

  it("refuses a recipient that is neither an address nor a name", () => {
    expect(() => validateRecipient("Not A Name!")).toThrow(RequestError);
  });

  it("refuses a damaged payload rather than half-reading it", () => {
    expect(() => decodeRequest("not-base64url-json")).toThrow(RequestError);
    expect(() => decodeRequest(btoa(JSON.stringify({ v: 99, to: "baker.cook" })))).toThrow(/newer/);
  });

  it("defaults to COOK decimals when no mint is named", () => {
    expect(tokenDecimals({ to: "baker.cook" })).toBe(9);
  });
});

describe("memos", () => {
  it("round-trips a reference and a note", () => {
    const memo = buildMemo({ to: "baker.cook", ref: "INV-7", note: "sesame" });
    expect(memo).toBe("cookiejar:1|INV-7|sesame");
    expect(parseMemo(memo)).toEqual({ ref: "INV-7", note: "sesame" });
  });

  it("keeps a note that contains the separator", () => {
    const memo = buildMemo({ to: "baker.cook", ref: "INV-7", note: "a|b|c" });
    expect(parseMemo(memo)).toEqual({ ref: "INV-7", note: "a|b|c" });
  });

  it("moves a separator out of the reference", () => {
    const memo = buildMemo({ to: "baker.cook", ref: "A|B", note: "x" });
    expect(parseMemo(memo)).toEqual({ ref: "A/B", note: "x" });
  });

  it("ignores a memo written by something else", () => {
    expect(parseMemo("gm")).toBeNull();
    expect(parseMemo("cookiejar:2|a|b")).toBeNull();
  });
});

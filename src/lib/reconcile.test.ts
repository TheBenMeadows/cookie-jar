import { describe, expect, it } from "vitest";

import { COOK_MINT } from "./config";
import type { JarPayment } from "./history";
import { normalizeRef, paymentsForRef, settlementOf } from "./reconcile";

const TOKEN = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";

function payment(over: Partial<JarPayment>): JarPayment {
  return {
    signature: "sig",
    blockTime: 1,
    from: null,
    rawAmount: 0n,
    mint: COOK_MINT,
    decimals: 9,
    symbol: "COOK",
    ref: null,
    note: null,
    ...over,
  };
}

describe("paymentsForRef", () => {
  it("keeps only the payments carrying the reference", () => {
    const rows = [
      payment({ signature: "a", ref: "INV-1" }),
      payment({ signature: "b", ref: "INV-2" }),
      payment({ signature: "c", ref: null }),
      payment({ signature: "d", ref: "INV-1" }),
    ];
    expect(paymentsForRef(rows, "INV-1").map((p) => p.signature)).toEqual(["a", "d"]);
  });

  it("matches a reference the way the memo wrote it: a pipe became a slash, edges trimmed", () => {
    const rows = [payment({ ref: "A/B" })];
    expect(paymentsForRef(rows, "A|B")).toHaveLength(1);
    expect(paymentsForRef(rows, "  A/B ")).toHaveLength(1);
    expect(normalizeRef(" x|y ")).toBe("x/y");
  });

  it("matches nothing for an empty reference rather than every unreferenced row", () => {
    expect(paymentsForRef([payment({ ref: null }), payment({ ref: "" })], "")).toEqual([]);
  });
});

describe("settlementOf", () => {
  it("is unpaid with no matching payment", () => {
    const s = settlementOf([payment({ ref: "OTHER", rawAmount: 5n })], "INV-1", COOK_MINT, 5n);
    expect(s.state).toBe("unpaid");
    expect(s.paidRaw).toBe(0n);
    expect(s.payments).toEqual([]);
  });

  it("is paid once the matching payments in the requested token reach the amount", () => {
    const rows = [
      payment({ signature: "a", ref: "INV-1", rawAmount: 3n }),
      payment({ signature: "b", ref: "INV-1", rawAmount: 2n }),
    ];
    const s = settlementOf(rows, "INV-1", COOK_MINT, 5n);
    expect(s.state).toBe("paid");
    expect(s.paidRaw).toBe(5n);
    expect(s.payments).toHaveLength(2);
  });

  it("is partial when the matching payments fall short", () => {
    const s = settlementOf([payment({ ref: "INV-1", rawAmount: 2n })], "INV-1", COOK_MINT, 5n);
    expect(s.state).toBe("partial");
    expect(s.paidRaw).toBe(2n);
    expect(s.requestedRaw).toBe(5n);
  });

  it("lists a payment in another token but does not count it toward the amount", () => {
    const rows = [payment({ ref: "INV-1", rawAmount: 100n, mint: TOKEN, decimals: 6, symbol: "" })];
    const s = settlementOf(rows, "INV-1", COOK_MINT, 5n);
    expect(s.state).toBe("unpaid");
    expect(s.payments).toHaveLength(1);
    expect(s.totals.map((t) => t.mint)).toEqual([TOKEN]);
  });

  it("treats an open request (no amount) as unpaid until something arrives, then paid", () => {
    expect(settlementOf([], "TIP", COOK_MINT, 0n).state).toBe("unpaid");
    expect(settlementOf([payment({ ref: "TIP", rawAmount: 1n })], "TIP", COOK_MINT, 0n).state).toBe(
      "paid",
    );
  });
});

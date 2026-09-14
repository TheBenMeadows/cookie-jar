import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { MEMO_PROGRAM_ID } from "./config";
import { HOUSEKEEPING_PROGRAMS, summarizeTransaction } from "./txdetail";

/** Builds a minimal mock transaction containing only the properties read by summarizeTransaction. */
function fakeTx(
  programIds: string[],
  opts?: { signatures?: number; inner?: number[] },
): ParsedTransactionWithMeta {
  const sigCount = opts?.signatures ?? 1;
  const signatures = new Array<string>(sigCount).fill("sig");
  const instructions = programIds.map((id) => ({
    programId: new PublicKey(id),
  }));
  const innerInstructions = opts?.inner
    ? opts.inner.map((count, index) => ({
        index,
        instructions: new Array(count).fill({}),
      }))
    : [];

  return {
    transaction: {
      signatures,
      message: {
        instructions,
      },
    },
    meta: {
      innerInstructions,
    },
  } as unknown as ParsedTransactionWithMeta;
}

describe("summarizeTransaction", () => {
  it("summarizes a landed composed checkout with venues, inner instructions, and memo", () => {
    const programIds = [
      "ComputeBudget111111111111111111111111111111",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "11111111111111111111111111111111",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    ];
    const tx = fakeTx(programIds, { signatures: 1, inner: [2, 3, 1] });
    const detail = summarizeTransaction(tx);

    expect(detail.signatures).toBe(1);
    expect(detail.instructions).toBe(11);
    expect(detail.innerInstructions).toBe(6);
    expect(detail.venues).toEqual(["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"]);
    expect(detail.hasMemo).toBe(true);
  });

  it("summarizes a plain COOK payment carrying a system transfer and memo", () => {
    const tx = fakeTx([
      "11111111111111111111111111111111",
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    ]);
    const detail = summarizeTransaction(tx);

    expect(detail.instructions).toBe(2);
    expect(detail.venues).toEqual([]);
    expect(detail.hasMemo).toBe(true);
  });

  it("identifies a transfer with no memo instruction", () => {
    const tx = fakeTx(["11111111111111111111111111111111"]);
    const detail = summarizeTransaction(tx);

    expect(detail.venues).toEqual([]);
    expect(detail.hasMemo).toBe(false);
  });

  it("deduplicates venues while preserving order of first appearance", () => {
    const venueA = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
    const venueB = "Ey35mr69UfiQqZSwD2qYAZoMNfnuVJGCjwNSB64ppHm7";
    const tx = fakeTx([venueA, venueB, venueA]);
    const detail = summarizeTransaction(tx);

    expect(detail.venues).toEqual([venueA, venueB]);
  });
});

describe("HOUSEKEEPING_PROGRAMS", () => {
  it("includes housekeeping program IDs and excludes swap venue IDs", () => {
    expect(HOUSEKEEPING_PROGRAMS.has(MEMO_PROGRAM_ID.toBase58())).toBe(true);
    expect(
      HOUSEKEEPING_PROGRAMS.has("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
    ).toBe(false);
  });
});

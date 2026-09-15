import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { MEMO_PROGRAM_ID } from "./config";
import { HOUSEKEEPING_PROGRAMS, summarizeTransaction } from "./txdetail";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const CPAMM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const OTHER = "Ey35mr69UfiQqZSwD2qYAZoMNfnuVJGCjwNSB64ppHm7";

/** A fake carrying only what the summary reads: program ids at the top level and in each inner group. */
function fakeTx(
  programIds: string[],
  opts?: { signatures?: number; inner?: string[][]; parsed?: (readonly [string, string] | null)[] },
): ParsedTransactionWithMeta {
  const instructions = programIds.map((id, i) => {
    const parse = opts?.parsed?.[i];
    if (!parse) return { programId: new PublicKey(id) };
    const [program, type] = parse;
    return { programId: new PublicKey(id), program, parsed: { type, info: {} } };
  });
  const innerInstructions = (opts?.inner ?? []).map((ids, index) => ({
    index,
    instructions: ids.map((id) => ({ programId: new PublicKey(id) })),
  }));
  return {
    transaction: { signatures: new Array<string>(opts?.signatures ?? 1).fill("sig"), message: { instructions } },
    meta: { innerInstructions },
  } as unknown as ParsedTransactionWithMeta;
}

describe("summarizeTransaction", () => {
  it("summarises the landed composed checkout: eleven instructions, one signature, one program beyond housekeeping", () => {
    // The instruction list of 3R1C9BBU…np5hFL, read from the chain on 2026-09-13. The CP-AMM's own
    // inner calls are token-program moves and a call back into itself.
    const tx = fakeTx([COMPUTE_BUDGET, ATA, SYSTEM, TOKEN, CPAMM, TOKEN, ATA, TOKEN, ATA, TOKEN, MEMO], {
      signatures: 1,
      inner: [
        [TOKEN, SYSTEM, TOKEN, TOKEN],
        [TOKEN, TOKEN, CPAMM],
        [TOKEN, SYSTEM, TOKEN, TOKEN],
      ],
    });
    const detail = summarizeTransaction(tx);
    expect(detail.signatures).toBe(1);
    expect(detail.instructions).toBe(11);
    expect(detail.innerInstructions).toBe(11);
    expect(detail.programs).toEqual([CPAMM]);
    expect(detail.hasMemo).toBe(true);
  });

  it("summarises a plain COOK payment: a system transfer and a memo, no other program", () => {
    const detail = summarizeTransaction(fakeTx([SYSTEM, MEMO]));
    expect(detail.instructions).toBe(2);
    expect(detail.programs).toEqual([]);
    expect(detail.hasMemo).toBe(true);
  });

  it("reports no memo when none is present", () => {
    const detail = summarizeTransaction(fakeTx([SYSTEM]));
    expect(detail.programs).toEqual([]);
    expect(detail.hasMemo).toBe(false);
  });

  it("lists a program called only from inside another, as a router calling a venue would", () => {
    const detail = summarizeTransaction(fakeTx([OTHER], { inner: [[TOKEN, CPAMM, TOKEN]] }));
    expect(detail.programs).toEqual([OTHER, CPAMM]);
  });

  it("counts a memo written from inside a program, as the jar does", () => {
    const detail = summarizeTransaction(fakeTx([OTHER], { inner: [[MEMO]] }));
    expect(detail.hasMemo).toBe(true);
  });

  it("lists each program once, in order of first appearance", () => {
    const detail = summarizeTransaction(fakeTx([CPAMM, OTHER, CPAMM]));
    expect(detail.programs).toEqual([CPAMM, OTHER]);
  });
});

describe("steps", () => {
  it("numbers the top-level instructions from one and keeps their order", () => {
    const { steps } = summarizeTransaction(fakeTx([COMPUTE_BUDGET, CPAMM, MEMO]));
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(steps.map((s) => s.programId)).toEqual([COMPUTE_BUDGET, CPAMM, MEMO]);
  });

  it("describes the instructions a payment is built from", () => {
    const { steps } = summarizeTransaction(
      fakeTx([TOKEN, MEMO], {
        parsed: [["spl-token", "transferChecked"], ["spl-memo", ""]],
      }),
    );
    expect(steps[0]?.parsed).toBe("spl-token transferChecked");
    expect(steps[0]?.sentence).toContain("Pays the recipient");
    expect(steps[1]?.sentence).toContain("invoice reference");
  });

  it("names the compute budget, which the parser leaves alone", () => {
    const { steps } = summarizeTransaction(fakeTx([COMPUTE_BUDGET]));
    expect(steps[0]?.parsed).toBeNull();
    expect(steps[0]?.sentence).toContain("computation");
  });

  it("offers no sentence for a program it does not know, and still names the id", () => {
    // The swap program on a composed checkout. A description here would be this app guessing.
    const { steps } = summarizeTransaction(fakeTx([CPAMM]));
    expect(steps[0]?.parsed).toBeNull();
    expect(steps[0]?.sentence).toBeNull();
    expect(steps[0]?.programId).toBe(CPAMM);
  });

  it("offers no sentence for a parsed instruction outside the payment path", () => {
    const { steps } = summarizeTransaction(fakeTx([TOKEN], { parsed: [["spl-token", "burn"]] }));
    expect(steps[0]?.parsed).toBe("spl-token burn");
    expect(steps[0]?.sentence).toBeNull();
  });
});

describe("HOUSEKEEPING_PROGRAMS", () => {
  it("holds the memo program and not the swap program", () => {
    expect(HOUSEKEEPING_PROGRAMS.has(MEMO_PROGRAM_ID.toBase58())).toBe(true);
    expect(HOUSEKEEPING_PROGRAMS.has(CPAMM)).toBe(false);
  });
});

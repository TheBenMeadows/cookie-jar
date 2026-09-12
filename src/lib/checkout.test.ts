import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_TRANSACTION_BYTES,
  composeSwapAndPayment,
  verifyComposedCheckout,
} from "./checkout";
import { MEMO_PROGRAM_ID } from "./config";
import { memoInstruction } from "./pay";

/**
 * How a swap and a payment share one transaction. The "router" here is a hand-built v0 transaction
 * with a recognisable instruction, so the test can see where its instructions end and ours begin.
 */

const PAYER = Keypair.generate().publicKey;
const RECIPIENT = Keypair.generate().publicKey;
const BLOCKHASH = "GfVcyD4kkTrXSWEaFoQ2xJ7NmGuYwUfHfXfR2Cx3Pn5B";
const ROUTER = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

function routerSwap(instructionCount = 1): VersionedTransaction {
  const instructions = Array.from({ length: instructionCount }, (_, i) =>
    new TransactionInstruction({
      programId: ROUTER,
      keys: [{ pubkey: PAYER, isSigner: true, isWritable: true }],
      data: Buffer.from([i]),
    }),
  );
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: BLOCKHASH,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function payment(): TransactionInstruction[] {
  return [
    SystemProgram.transfer({ fromPubkey: PAYER, toPubkey: RECIPIENT, lamports: 5_000n }),
    memoInstruction("cookiejar:1|INV-1|", PAYER),
  ];
}

describe("composeSwapAndPayment", () => {
  it("keeps the router's instructions first, then the payment, paid for by the payer", () => {
    const composed = composeSwapAndPayment({
      swap: routerSwap(2),
      lookupTables: [],
      payment: payment(),
      payer: PAYER,
      blockhash: BLOCKHASH,
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const message = TransactionMessage.decompile(composed.transaction.message);
    expect(message.instructions.map((ix) => ix.programId.toBase58())).toEqual([
      ROUTER.toBase58(),
      ROUTER.toBase58(),
      SystemProgram.programId.toBase58(),
      MEMO_PROGRAM_ID.toBase58(),
    ]);
    expect(message.payerKey.equals(PAYER)).toBe(true);
    expect(composed.transaction.message.header.numRequiredSignatures).toBe(1);
    expect(composed.bytes).toBe(composed.transaction.serialize().length);
    expect(composed.bytes).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);
  });

  it("refuses rather than builds a transaction over the size limit", () => {
    // Grow the payment one byte at a time: the last size that fits is at the limit, and the first
    // that does not is refused with its bytes measured.
    let lastFit = 0;
    let firstRefusal: ReturnType<typeof composeSwapAndPayment> | null = null;
    for (let n = 900; n < 1_300 && !firstRefusal; n += 1) {
      const composed = composeSwapAndPayment({
        swap: routerSwap(1),
        lookupTables: [],
        payment: [...payment(), memoInstruction("x".repeat(n), PAYER)],
        payer: PAYER,
        blockhash: BLOCKHASH,
      });
      if (composed.ok) lastFit = composed.bytes;
      else firstRefusal = composed;
    }
    expect(lastFit).toBe(MAX_TRANSACTION_BYTES);
    expect(firstRefusal).toMatchObject({ ok: false, reason: "too-big", bytes: MAX_TRANSACTION_BYTES + 1 });

    // Far past it: the message will not serialize at all, and that is still a refusal, not a throw.
    const far = composeSwapAndPayment({
      swap: routerSwap(1),
      lookupTables: [],
      payment: [...payment(), ...Array.from({ length: 6 }, () => memoInstruction("x".repeat(200), PAYER))],
      payer: PAYER,
      blockhash: BLOCKHASH,
    });
    expect(far).toEqual({ ok: false, reason: "too-big", bytes: null });
  });
});

describe("verifyComposedCheckout", () => {
  function connectionWith(opts: { before: number; after: number; err?: unknown }): Connection {
    return {
      getBalance: vi.fn(async () => opts.before),
      simulateTransaction: vi.fn(async () => ({
        value: {
          err: opts.err ?? null,
          logs: ["log a", "log b"],
          accounts: [{ lamports: opts.after, data: ["", "base64"] }],
        },
      })),
    } as unknown as Connection;
  }

  it("passes when the recipient ends exactly the payment richer", async () => {
    const result = await verifyComposedCheckout({
      connection: connectionWith({ before: 100, after: 5_100 }),
      transaction: routerSwap(),
      destination: RECIPIENT,
      native: true,
      rawAmount: 5_000n,
    });
    expect(result).toEqual({ ok: true, reason: null });
  });

  it("refuses when the recipient's balance moves by any other amount", async () => {
    const result = await verifyComposedCheckout({
      connection: connectionWith({ before: 100, after: 4_100 }),
      transaction: routerSwap(),
      destination: RECIPIENT,
      native: true,
      rawAmount: 5_000n,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/4000 base units rather than the 5000/);
  });

  it("refuses when the two halves do not simulate together", async () => {
    const result = await verifyComposedCheckout({
      connection: connectionWith({ before: 100, after: 100, err: { InstructionError: [3, "Custom"] } }),
      transaction: routerSwap(),
      destination: RECIPIENT,
      native: true,
      rawAmount: 5_000n,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/did not simulate together: log a \| log b/);
  });
});

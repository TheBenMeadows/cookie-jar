import {
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { describe, expect, it, vi } from "vitest";

import { COOKIE_JAR_TREASURY, COOK_MINT, MEMO_PROGRAM_ID } from "./config";
import {
  buildPayment,
  chooseSourceAccount,
  fetchMintFacts,
  PaymentError,
  recipientAccountRent,
  roundUpAmount,
} from "./pay";
import { bestSwapQuote, verifySwapTransaction, type SwapQuote } from "./swap";

/**
 * The checks that stand between a payer and a transaction that moves the wrong money. Each one is
 * driven by a stub connection rather than the live chain, so a failure names the rule that broke
 * instead of blaming the network.
 */

const MINT = new PublicKey("GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z");
const OTHER_MINT = new PublicKey("EkPafx58mgwkEnGwo62jXhXDAdJ37Z8G8MFBRPsr9uhz");
const PAYER = new PublicKey("4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx");
const RECIPIENT = new PublicKey("7rQTSWbk1nMRPve2q3wcS1rT6g2shkXkNDGnZX53zEzR");

/** A 165-byte SPL token account: mint at 0, owner at 32, amount at 64. */
function tokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return data;
}

/** A mint account: decimals sit at offset 44, and `isInitialized` at 45. */
function mintAccount(decimals: number): Buffer {
  const data = Buffer.alloc(82);
  data.writeUInt8(decimals, 44);
  data.writeUInt8(1, 45);
  return data;
}

describe("the mint is read from the chain, not from the link", () => {
  it("reports the decimals the chain holds", async () => {
    const connection = {
      getAccountInfo: vi.fn(async () => ({ owner: TOKEN_PROGRAM_ID, data: mintAccount(6) })),
    } as never;
    expect(await fetchMintFacts(connection, MINT)).toMatchObject({ decimals: 6 });
  });

  it("refuses to build when a link's decimals disagree with the chain", async () => {
    const connection = {
      getAccountInfo: vi.fn(async () => ({ owner: TOKEN_PROGRAM_ID, data: mintAccount(9) })),
      getLatestBlockhash: vi.fn(async () => ({ blockhash: "x", lastValidBlockHeight: 1 })),
      getParsedTokenAccountsByOwner: vi.fn(async () => ({ value: [] })),
    } as never;

    await expect(
      buildPayment({
        connection,
        payer: PAYER,
        recipient: RECIPIENT,
        rawAmount: 1_000_000n,
        mint: MINT.toBase58(),
        decimals: 6,
        memo: "cookiejar:1||",
      }),
    ).rejects.toThrow(/link says .* 6 decimals; the chain says 9/);
  });
});

describe("the transfer draws from an account that can cover it", () => {
  const stub = (accounts: Array<{ pubkey: PublicKey; amount: bigint }>) =>
    ({
      getParsedTokenAccountsByOwner: vi.fn(async () => ({
        value: accounts.map(({ pubkey, amount }) => ({
          pubkey,
          account: { data: { parsed: { info: { tokenAmount: { amount: amount.toString() } } } } },
        })),
      })),
    }) as never;

  it("refuses when the balance is there but split across accounts", async () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    await expect(
      chooseSourceAccount(stub([{ pubkey: a, amount: 60n }, { pubkey: b, amount: 60n }]), PAYER, MINT, TOKEN_PROGRAM_ID, 100n),
    ).rejects.toThrow(/split across 2 accounts/);
  });

  it("draws from a non-associated account when that is the one holding enough", async () => {
    const big = Keypair.generate().publicKey;
    const chosen = await chooseSourceAccount(
      stub([{ pubkey: big, amount: 500n }]),
      PAYER,
      MINT,
      TOKEN_PROGRAM_ID,
      100n,
    );
    expect(chosen.toBase58()).toBe(big.toBase58());
  });

  it("says so when no account holds enough", async () => {
    const a = Keypair.generate().publicKey;
    await expect(
      chooseSourceAccount(stub([{ pubkey: a, amount: 5n }]), PAYER, MINT, TOKEN_PROGRAM_ID, 100n),
    ).rejects.toThrow(/does not hold enough/);
  });
});

describe("an SPL payment names the recipient's wallet", () => {
  /** `getAccountInfo` answers for the mint, then for the recipient's token account. */
  const stub = (destinationExists: boolean) =>
    ({
      getAccountInfo: vi.fn(async (key: PublicKey) => {
        if (key.equals(MINT)) return { owner: TOKEN_PROGRAM_ID, data: mintAccount(6) };
        return destinationExists ? { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(165) } : null;
      }),
      getParsedTokenAccountsByOwner: vi.fn(async () => ({
        value: [
          {
            pubkey: Keypair.generate().publicKey,
            account: { data: { parsed: { info: { tokenAmount: { amount: "1000000" } } } } },
          },
        ],
      })),
      getLatestBlockhash: vi.fn(async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      })),
    }) as never;

  const build = async (destinationExists: boolean) =>
    buildPayment({
      connection: stub(destinationExists),
      payer: PAYER,
      recipient: RECIPIENT,
      rawAmount: 1000n,
      mint: MINT.toBase58(),
      decimals: 6,
      memo: "cookiejar:1|INV-1|a token payment",
    });

  it("carries the wallet as an account key when its token account already exists", async () => {
    const built = await build(true);
    const keys = built.transaction.compileMessage().accountKeys.map((k) => k.toBase58());
    expect(keys).toContain(RECIPIENT.toBase58());
    // The account was there, so nobody pays rent for it, and the fee row must not say they do.
    expect(built.createsRecipientAccount).toBe(false);
  });

  it("carries it on the first payment too, and reports the rent", async () => {
    const built = await build(false);
    const keys = built.transaction.compileMessage().accountKeys.map((k) => k.toBase58());
    expect(keys).toContain(RECIPIENT.toBase58());
    expect(built.createsRecipientAccount).toBe(true);
  });
});

describe("the rent a payer spends opening the recipient's token account", () => {
  const ata2022 = getAssociatedTokenAddressSync(MINT, RECIPIENT, true, TOKEN_2022_PROGRAM_ID);
  const stub = (present: PublicKey | null) =>
    ({
      getAccountInfo: vi.fn(async (key: PublicKey) =>
        present && key.equals(present) ? { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(165) } : null,
      ),
      getMinimumBalanceForRentExemption: vi.fn(async () => 2_039_280),
    }) as never;

  it("is the rent-exempt minimum when the account exists under neither program", async () => {
    expect(await recipientAccountRent(stub(null), MINT, RECIPIENT)).toBe(2_039_280n);
  });

  it("is zero when the account exists under Token-2022", async () => {
    expect(await recipientAccountRent(stub(ata2022), MINT, RECIPIENT)).toBe(0n);
  });
});

describe("the Cookie Jar round-up", () => {
  const TREASURY = new PublicKey(COOKIE_JAR_TREASURY);

  it("is a whole-number share, never silently nothing", () => {
    expect(roundUpAmount(1_000_000_000n, 100)).toBe(10_000_000n);
    expect(roundUpAmount(10_000n, 100)).toBe(100n);
    expect(roundUpAmount(50n, 100)).toBe(1n);
    expect(roundUpAmount(0n, 100)).toBe(0n);
    expect(roundUpAmount(1_000n, 0)).toBe(0n);
  });

  it("adds a second native transfer to the treasury under the one memo", async () => {
    const connection = {
      getLatestBlockhash: vi.fn(async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 })),
    } as never;
    const built = await buildPayment({
      connection,
      payer: PAYER,
      recipient: RECIPIENT,
      rawAmount: 1_000_000_000n,
      decimals: 9,
      memo: "cookiejar:1|INV-1|",
      roundUp: { to: TREASURY, rawAmount: 10_000_000n },
    });
    const programs = built.transaction.instructions.map((ix) => ix.programId.toBase58());
    expect(programs).toEqual([
      SystemProgram.programId.toBase58(),
      SystemProgram.programId.toBase58(),
      MEMO_PROGRAM_ID.toBase58(),
    ]);
    const second = built.transaction.instructions[1];
    expect(second?.keys[1]?.pubkey.equals(TREASURY)).toBe(true);
    expect(SystemInstruction.decodeTransfer(second as never).lamports).toBe(10_000_000n);
  });

  it("adds an idempotent create and a checked transfer for a token payment", async () => {
    const connection = {
      getAccountInfo: vi.fn(async (key: PublicKey) => {
        if (key.equals(MINT)) return { owner: TOKEN_PROGRAM_ID, data: mintAccount(6) };
        return null;
      }),
      getParsedTokenAccountsByOwner: vi.fn(async () => ({
        value: [
          {
            pubkey: getAssociatedTokenAddressSync(MINT, PAYER, true, TOKEN_PROGRAM_ID),
            account: { data: { parsed: { info: { tokenAmount: { amount: "1000000" } } } } },
          },
        ],
      })),
      getLatestBlockhash: vi.fn(async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 })),
    } as never;
    const built = await buildPayment({
      connection,
      payer: PAYER,
      recipient: RECIPIENT,
      rawAmount: 1000n,
      mint: MINT.toBase58(),
      decimals: 6,
      memo: "cookiejar:1|INV-1|",
      roundUp: { to: TREASURY, rawAmount: 10n },
    });
    const programs = built.transaction.instructions.map((ix) => ix.programId.toBase58());
    expect(programs).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      MEMO_PROGRAM_ID.toBase58(),
    ]);
    const keys = built.transaction.compileMessage().accountKeys.map((k) => k.toBase58());
    expect(keys).toContain(TREASURY.toBase58());
  });

  it("is left out when its amount is zero, and refused when it targets the recipient", async () => {
    const connection = {
      getLatestBlockhash: vi.fn(async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 })),
    } as never;
    const none = await buildPayment({
      connection,
      payer: PAYER,
      recipient: RECIPIENT,
      rawAmount: 1_000n,
      decimals: 9,
      memo: "cookiejar:1||",
      roundUp: { to: TREASURY, rawAmount: 0n },
    });
    expect(none.transaction.instructions).toHaveLength(2);
    await expect(
      buildPayment({
        connection,
        payer: PAYER,
        recipient: RECIPIENT,
        rawAmount: 1_000n,
        decimals: 9,
        memo: "cookiejar:1||",
        roundUp: { to: RECIPIENT, rawAmount: 10n },
      }),
    ).rejects.toThrow(/same wallet/);
  });
});

describe("paying your own jar", () => {
  it("is refused before anything is built", async () => {
    await expect(
      buildPayment({
        connection: {} as never,
        payer: PAYER,
        recipient: PAYER,
        rawAmount: 1n,
        decimals: 9,
        memo: "x",
      }),
    ).rejects.toBeInstanceOf(PaymentError);
  });
});

// --- Swap verification ----------------------------------------------------------------------------

const QUOTE: SwapQuote = {
  aggregator: "cookiebox",
  inputMint: OTHER_MINT.toBase58(),
  outputMint: MINT.toBase58(),
  inAmount: "1000",
  outAmount: "5000",
  minOutAmount: "4500",
  priceImpactPct: 0,
  venues: ["test"],
  swapUrl: "https://example.invalid",
  route: {},
};

function transactionFrom(payer: PublicKey, extraSigner?: PublicKey): VersionedTransaction {
  const keys = [{ pubkey: payer, isSigner: true, isWritable: true }];
  if (extraSigner) keys.push({ pubkey: extraSigner, isSigner: true, isWritable: false });
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [{ programId: TOKEN_PROGRAM_ID, keys, data: Buffer.alloc(0) }],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

interface Owned {
  pubkey: PublicKey;
  mint: PublicKey;
  before: bigint;
  after: bigint;
}

/**
 * The RPC answers `simulateTransaction` with one slot per address asked for, in that order, and a
 * null slot for an address that holds no account. `after` names what each watched account ends at;
 * an address the caller derives but the wallet does not own answers null unless `opened` gives it a
 * balance. The last slot is always the owner's own, which carries the lamports.
 */
function swapConnection(
  owned: Owned[],
  lamportsBefore = 0n,
  lamportsAfter = lamportsBefore,
  opened: Owned[] = [],
) {
  const byAddress = new Map(
    [...owned, ...opened].map((o) => [o.pubkey.toBase58(), o] as const),
  );
  return {
    getTokenAccountsByOwner: vi.fn(async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      value: filter.programId.equals(TOKEN_PROGRAM_ID)
        ? owned.map((o) => ({
            pubkey: o.pubkey,
            account: { data: tokenAccount(o.mint, PAYER, o.before) },
          }))
        : [],
    })),
    getBalance: vi.fn(async () => Number(lamportsBefore)),
    simulateTransaction: vi.fn(
      async (_tx: unknown, config: { accounts?: { addresses: string[] } }) => {
        const addresses = config.accounts?.addresses ?? [];
        return {
          value: {
            err: null,
            logs: [],
            accounts: addresses.map((address, i) => {
              if (i === addresses.length - 1) {
                return { data: ["", "base64"], lamports: Number(lamportsAfter) };
              }
              const account = byAddress.get(address);
              if (!account) return null;
              return {
                data: [tokenAccount(account.mint, PAYER, account.after).toString("base64"), "base64"],
                lamports: 0,
              };
            }),
          },
        };
      },
    ),
  } as never;
}

describe("a swap transaction is checked before a wallet sees it", () => {
  it("passes when the promised output arrives and nothing else moves", async () => {
    const out = Keypair.generate().publicKey;
    const inn = Keypair.generate().publicKey;
    const result = await verifySwapTransaction({
      connection: swapConnection([
        { pubkey: out, mint: MINT, before: 0n, after: 5000n },
        { pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n },
      ]),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result).toMatchObject({ ok: true, expectedOutRaw: 5000n });
  });

  it("refuses a transaction this wallet does not pay for", async () => {
    const result = await verifySwapTransaction({
      connection: swapConnection([]),
      transaction: transactionFrom(RECIPIENT),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/paid for by/);
  });

  it("refuses a transaction that wants a second signature", async () => {
    const result = await verifySwapTransaction({
      connection: swapConnection([]),
      transaction: transactionFrom(PAYER, RECIPIENT),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/needs 2 signatures/);
  });

  it("refuses when the output falls short of the quoted minimum", async () => {
    const out = Keypair.generate().publicKey;
    const result = await verifySwapTransaction({
      connection: swapConnection([{ pubkey: out, mint: MINT, before: 0n, after: 100n }]),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/promised at least 4500 base units out; the simulation delivers 100/);
  });

  it("refuses when a token the quote never mentioned leaves the wallet", async () => {
    const out = Keypair.generate().publicKey;
    const bystander = Keypair.generate().publicKey;
    const result = await verifySwapTransaction({
      connection: swapConnection([
        { pubkey: out, mint: MINT, before: 0n, after: 5000n },
        { pubkey: bystander, mint: new PublicKey(COOK_MINT), before: 900n, after: 100n },
      ]),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/also takes 800 base units/);
  });

  it("refuses a swap that also drains the wallet's native balance", async () => {
    const out = Keypair.generate().publicKey;
    const inn = Keypair.generate().publicKey;
    const result = await verifySwapTransaction({
      connection: swapConnection(
        [
          { pubkey: out, mint: MINT, before: 0n, after: 5000n },
          { pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n },
        ],
        1_000_000_000n,
        500_000_000n,
      ),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/also takes 500000000 lamports/);
  });

  it("lets a swap that sells native COOK spend the quoted lamports, and no more", async () => {
    const nativeIn: SwapQuote = { ...QUOTE, inputMint: COOK_MINT, inAmount: "1000000000" };
    const out = Keypair.generate().publicKey;
    // The quoted input, fee and rent leave; the output arrives in a token account.
    const fine = await verifySwapTransaction({
      connection: swapConnection(
        [{ pubkey: out, mint: MINT, before: 0n, after: 5000n }],
        5_000_000_000n,
        5_000_000_000n - 1_000_000_000n - 2_044_280n,
      ),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: nativeIn,
    });
    expect(fine).toEqual({ ok: true, reason: null, expectedOutRaw: 5000n });

    // Past the quoted input plus the allowance is a route helping itself.
    const greedy = await verifySwapTransaction({
      connection: swapConnection(
        [{ pubkey: out, mint: MINT, before: 0n, after: 5000n }],
        5_000_000_000n,
        5_000_000_000n - 1_000_000_000n - 20_000_000n,
      ),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: nativeIn,
    });
    expect(greedy.ok).toBe(false);
    expect(greedy.reason).toMatch(/takes 1020000000 lamports out of this wallet; the quote was for 1000000000/);
  });

  it("refuses a route that spends more of the input than the quote asked for", async () => {
    const out = Keypair.generate().publicKey;
    const inn = Keypair.generate().publicKey;
    const result = await verifySwapTransaction({
      connection: swapConnection([
        { pubkey: out, mint: MINT, before: 0n, after: 5000n },
        { pubkey: inn, mint: OTHER_MINT, before: 1_000_000n, after: 0n },
      ]),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/spends 1000000 base units .*; the quote was for 1000/);
  });

  it("measures a native output rather than crediting the fee allowance to it", async () => {
    const nativeQuote: SwapQuote = {
      ...QUOTE,
      outputMint: COOK_MINT,
      outAmount: "5000000000",
      minOutAmount: "4500000000",
    };
    const inn = Keypair.generate().publicKey;

    const delivered = await verifySwapTransaction({
      connection: swapConnection(
        [{ pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n }],
        1_000_000_000n,
        5_999_995_000n,
      ),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: nativeQuote,
    });
    // The 5,000 lamports of fee come out of the same balance, so the figure the button shows is what
    // the wallet ends up with and not a cent more.
    expect(delivered).toMatchObject({ ok: true, expectedOutRaw: 4_999_995_000n });

    const empty = await verifySwapTransaction({
      connection: swapConnection(
        [{ pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n }],
        1_000_000_000n,
        999_995_000n,
      ),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: nativeQuote,
    });
    expect(empty.ok).toBe(false);
    expect(empty.reason).toMatch(/promised at least 4500000000 base units out/);

    // A minimum under the fee allowance does not turn "nothing arrived" into a pass.
    const tiny = await verifySwapTransaction({
      connection: swapConnection(
        [{ pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n }],
        1_000_000_000n,
        999_995_000n,
      ),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: { ...nativeQuote, outAmount: "5000000", minOutAmount: "4500000" },
    });
    expect(tiny.ok).toBe(false);
    expect(tiny.expectedOutRaw).toBe(-5000n);
  });

  it("watches a wallet with more token accounts than one simulation reports, in chunks", async () => {
    // The RPC reports at most 17 accounts per simulation. Sixty holdings plus the two derived
    // output addresses are watched across four simulations, the owner in each, and nothing is
    // left unwatched: a drain in the last chunk is still caught.
    const owned: Owned[] = Array.from({ length: 60 }, () => ({
      pubkey: Keypair.generate().publicKey,
      mint: OTHER_MINT,
      before: 10n,
      after: 10n,
    }));
    const out = Keypair.generate().publicKey;
    const clean = swapConnection([...owned, { pubkey: out, mint: MINT, before: 0n, after: 5000n }]);
    const fine = await verifySwapTransaction({
      connection: clean,
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(fine).toEqual({ ok: true, reason: null, expectedOutRaw: 5000n });
    const calls = (clean as unknown as { simulateTransaction: ReturnType<typeof vi.fn> })
      .simulateTransaction.mock.calls as [unknown, { accounts: { addresses: string[] } }][];
    expect(calls).toHaveLength(4);
    for (const [, config] of calls) {
      expect(config.accounts.addresses.length).toBeLessThanOrEqual(17);
      expect(config.accounts.addresses.at(-1)).toBe(PAYER.toBase58());
    }

    // A token the quote never named, sitting in the last chunk, goes down.
    const unrelated = Keypair.generate().publicKey;
    const drained = swapConnection([
      ...owned,
      { pubkey: Keypair.generate().publicKey, mint: unrelated, before: 10n, after: 0n },
      { pubkey: out, mint: MINT, before: 0n, after: 5000n },
    ]);
    const caught = await verifySwapTransaction({
      connection: drained,
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(caught.ok).toBe(false);
    expect(caught.reason).toMatch(/also takes 10 base units/);
  });

  it("reads the output across accounts as a net figure", async () => {
    const drained = Keypair.generate().publicKey;
    const credited = Keypair.generate().publicKey;
    const inn = Keypair.generate().publicKey;

    const takesMoreThanItGives = await verifySwapTransaction({
      connection: swapConnection([
        { pubkey: drained, mint: MINT, before: 1000n, after: 0n },
        { pubkey: credited, mint: MINT, before: 0n, after: 500n },
        { pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n },
      ]),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(takesMoreThanItGives.ok).toBe(false);
    expect(takesMoreThanItGives.reason).toMatch(/the simulation delivers -500/);

    const delivers = await verifySwapTransaction({
      connection: swapConnection([
        { pubkey: drained, mint: MINT, before: 1000n, after: 900n },
        { pubkey: credited, mint: MINT, before: 0n, after: 5000n },
        { pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n },
      ]),
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(delivers).toMatchObject({ ok: true, expectedOutRaw: 4900n });
  });

  describe("swapping into a token this wallet has never held", () => {
    /** The account the swap opens: the associated address for the output mint, currently empty. */
    const destination = getAssociatedTokenAddressSync(MINT, PAYER, false, TOKEN_PROGRAM_ID);
    const inn = Keypair.generate().publicKey;

    it("passes when the account the swap opens receives the output", async () => {
      const result = await verifySwapTransaction({
        connection: swapConnection(
          [{ pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n }],
          0n,
          0n,
          [{ pubkey: destination, mint: MINT, before: 0n, after: 5000n }],
        ),
        transaction: transactionFrom(PAYER),
        owner: PAYER,
        quote: QUOTE,
      });
      expect(result).toMatchObject({ ok: true, expectedOutRaw: 5000n });
    });

    it("refuses when nothing arrives there either", async () => {
      const result = await verifySwapTransaction({
        connection: swapConnection([{ pubkey: inn, mint: OTHER_MINT, before: 1000n, after: 0n }]),
        transaction: transactionFrom(PAYER),
        owner: PAYER,
        quote: QUOTE,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/did not show this wallet receiving/);
    });
  });

  it("refuses when the simulation itself fails", async () => {
    const connection = {
      getTokenAccountsByOwner: vi.fn(async () => ({ value: [] })),
      getBalance: vi.fn(async () => 0),
      simulateTransaction: vi.fn(async () => ({
        value: { err: "InstructionError", logs: ["Program failed"], accounts: [] },
      })),
    } as never;
    const result = await verifySwapTransaction({
      connection,
      transaction: transactionFrom(PAYER),
      owner: PAYER,
      quote: QUOTE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/did not simulate/);
  });
});

describe("comparing quotes", () => {
  it("drops a router whose amount is not a whole number instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("agg.cookiebox.app")
          ? { route: { inAmount: "1000", outAmount: "12.5", minOutAmount: "12.5", segments: [] } }
          : {
              multiRoute: {
                totalInAmount: "1000",
                totalOutAmount: "4000",
                minOutAmount: "3800",
                segments: [],
              },
            };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const best = await bestSwapQuote({
      inputMint: OTHER_MINT.toBase58(),
      outputMint: MINT.toBase58(),
      rawAmount: "1000",
    });
    expect(best?.aggregator).toBe("candyshop");
    expect(best?.outAmount).toBe("4000");
    vi.unstubAllGlobals();
  });
});

describe("token-2022 mints", () => {
  it("are recognised as a different program", async () => {
    const connection = {
      getAccountInfo: vi.fn(async () => ({ owner: TOKEN_2022_PROGRAM_ID, data: mintAccount(2) })),
    } as never;
    const facts = await fetchMintFacts(connection, MINT);
    expect(facts.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(facts.decimals).toBe(2);
  });
});

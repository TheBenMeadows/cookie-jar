import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { describe, expect, it, vi } from "vitest";

import { COOK_MINT } from "./config";
import { buildPayment, chooseSourceAccount, fetchMintFacts, PaymentError } from "./pay";
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

function swapConnection(owned: Owned[], lamports = 0n) {
  return {
    getTokenAccountsByOwner: vi.fn(async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      value: filter.programId.equals(TOKEN_PROGRAM_ID)
        ? owned.map((o) => ({
            pubkey: o.pubkey,
            account: { data: tokenAccount(o.mint, PAYER, o.before) },
          }))
        : [],
    })),
    getBalance: vi.fn(async () => Number(lamports)),
    simulateTransaction: vi.fn(async () => ({
      value: {
        err: null,
        logs: [],
        accounts: [
          ...owned.map((o) => ({
            data: [tokenAccount(o.mint, PAYER, o.after).toString("base64"), "base64"],
            lamports: 0,
          })),
          { data: ["", "base64"], lamports: Number(lamports) },
        ],
      },
    })),
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

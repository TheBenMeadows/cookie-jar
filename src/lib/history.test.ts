import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { describe, expect, it, vi } from "vitest";

import { COOK_MINT, MEMO_PROGRAM_ID } from "./config";
import { fetchJarHistory, MAX_TOKEN_ACCOUNTS, SCAN_CAP } from "./history";

/**
 * What a jar can read back about itself. Every connection here is a stub shaped like the RPC's own
 * answers, so a failure names the rule that broke rather than the network.
 */

const JAR = new PublicKey("7rQTSWbk1nMRPve2q3wcS1rT6g2shkXkNDGnZX53zEzR");
const SENDER = new PublicKey("4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx");
const TOKEN_MINT = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";

interface SignatureEntry {
  signature: string;
  err: null;
  memo: string | null;
  blockTime: number | null;
  slot: number;
}

interface TokenBalance {
  accountIndex: number;
  owner: string;
  mint: string;
  amount: string;
}

interface TxOpts {
  signature: string;
  memo?: string;
  memos?: string[];
  /** Account keys in order; index 0 is the fee payer. */
  keys: PublicKey[];
  preBalances?: number[];
  postBalances?: number[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
  blockTime?: number | null;
}

/** A `getParsedTransaction`-shaped object, only as deep as `history.ts` reads it. */
function parsedTx(o: TxOpts): unknown {
  const balance = (b: TokenBalance) => ({
    accountIndex: b.accountIndex,
    owner: b.owner,
    mint: b.mint,
    uiTokenAmount: { amount: b.amount, decimals: 9, uiAmount: 0, uiAmountString: b.amount },
  });
  const zeros = o.keys.map(() => 0);
  const memos = o.memos ?? (o.memo !== undefined ? [o.memo] : []);
  return {
    blockTime: o.blockTime === undefined ? 1_760_000_000 : o.blockTime,
    transaction: {
      signatures: [o.signature],
      message: {
        accountKeys: o.keys.map((pubkey) => ({ pubkey, signer: false, writable: true })),
        instructions: memos.map((parsed) => ({ programId: MEMO_PROGRAM_ID, parsed })),
      },
    },
    meta: {
      err: null,
      innerInstructions: [],
      preBalances: o.preBalances ?? zeros,
      postBalances: o.postBalances ?? zeros,
      preTokenBalances: (o.preTokenBalances ?? []).map(balance),
      postTokenBalances: (o.postTokenBalances ?? []).map(balance),
    },
  };
}

function entry(signature: string, index: number): SignatureEntry {
  return {
    signature,
    err: null,
    memo: `[0] cookiejar:1|INV-${index}|note`,
    blockTime: 1_760_000_000 - index,
    slot: 1_000 - index,
  };
}

function connectionFor(opts: {
  /** Signatures per address, newest first, the way the RPC returns them. */
  signatures: Record<string, SignatureEntry[]>;
  transactions: Record<string, unknown>;
  tokenAccounts?: PublicKey[];
}) {
  return {
    getTokenAccountsByOwner: vi.fn(async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      value: filter.programId.equals(TOKEN_PROGRAM_ID)
        ? (opts.tokenAccounts ?? []).map((pubkey) => ({
            pubkey,
            account: { data: Buffer.alloc(165) },
          }))
        : [],
    })),
    getSignaturesForAddress: vi.fn(
      async (address: PublicKey, page: { limit: number; before?: string }) => {
        const all = opts.signatures[address.toBase58()] ?? [];
        const start = page.before ? all.findIndex((e) => e.signature === page.before) + 1 : 0;
        return all.slice(start, start + page.limit);
      },
    ),
    getParsedTransactions: vi.fn(async (batch: string[]) =>
      batch.map((signature) => opts.transactions[signature] ?? null),
    ),
  } as never;
}

describe("a jar reads its token accounts as well as its wallet", () => {
  it("finds a payment that only the token account carries", async () => {
    const ata = Keypair.generate().publicKey;
    const tx = parsedTx({
      signature: "sig-spl",
      memo: "cookiejar:1|INV-1|a token payment",
      // The wallet is absent from the keys, which is what a bare transfer to an existing account
      // looks like on chain.
      keys: [SENDER, ata, new PublicKey(TOKEN_MINT)],
      postTokenBalances: [
        { accountIndex: 1, owner: JAR.toBase58(), mint: TOKEN_MINT, amount: "500" },
      ],
    });

    const history = await fetchJarHistory(
      connectionFor({
        signatures: { [JAR.toBase58()]: [], [ata.toBase58()]: [entry("sig-spl", 0)] },
        transactions: { "sig-spl": tx },
        tokenAccounts: [ata],
      }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(1);
    expect(history.payments[0]).toMatchObject({
      signature: "sig-spl",
      mint: TOKEN_MINT,
      rawAmount: 500n,
    });
  });

  it("still finds a native payment on the wallet when the jar owns token accounts", async () => {
    const ata = Keypair.generate().publicKey;
    const tx = parsedTx({
      signature: "sig-native",
      memo: "cookiejar:1|INV-7|a COOK payment",
      keys: [SENDER, JAR],
      preBalances: [10_000_000, 0],
      postBalances: [8_999_000, 1_000_000],
    });

    const history = await fetchJarHistory(
      connectionFor({
        signatures: { [JAR.toBase58()]: [entry("sig-native", 0)], [ata.toBase58()]: [] },
        transactions: { "sig-native": tx },
        tokenAccounts: [ata],
      }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(1);
    expect(history.payments[0]).toMatchObject({ mint: COOK_MINT, rawAmount: 1_000_000n });
  });

  it("lists a transaction once when the wallet and the token account both report it", async () => {
    const ata = Keypair.generate().publicKey;
    const tx = parsedTx({
      signature: "sig-both",
      memo: "cookiejar:1|INV-2|one payment",
      keys: [SENDER, JAR, ata],
      postTokenBalances: [
        { accountIndex: 2, owner: JAR.toBase58(), mint: TOKEN_MINT, amount: "700" },
      ],
    });

    const history = await fetchJarHistory(
      connectionFor({
        signatures: {
          [JAR.toBase58()]: [entry("sig-both", 0)],
          [ata.toBase58()]: [entry("sig-both", 0)],
        },
        transactions: { "sig-both": tx },
        tokenAccounts: [ata],
      }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(1);
    expect(history.payments[0]?.rawAmount).toBe(700n);
  });
});

describe("a jar whose wallet holds far more history than the cap", () => {
  /** Signatures that are not Cookie Tab payments: read, counted against the cap, never candidates. */
  function noise(count: number): SignatureEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      signature: `noise${i}`,
      err: null,
      memo: "[0] a transfer with some other memo",
      blockTime: 1_760_000_000 - i,
      slot: 9_000 - i,
    }));
  }

  it("still reads the token account, and says the cap stopped it", async () => {
    const ata = Keypair.generate().publicKey;
    const tx = parsedTx({
      signature: "sig-spl",
      memo: "cookiejar:1|INV-1|a token payment",
      keys: [SENDER, ata, new PublicKey(TOKEN_MINT)],
      postTokenBalances: [
        { accountIndex: 1, owner: JAR.toBase58(), mint: TOKEN_MINT, amount: "500" },
      ],
    });

    const history = await fetchJarHistory(
      connectionFor({
        signatures: {
          [JAR.toBase58()]: noise(1200),
          [ata.toBase58()]: [entry("sig-spl", 0)],
        },
        transactions: { "sig-spl": tx },
        tokenAccounts: [ata],
      }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(1);
    expect(history.payments[0]?.rawAmount).toBe(500n);
    expect(history.scanned).toBeGreaterThanOrEqual(SCAN_CAP);
    expect(history.hitCap).toBe(true);
    expect(history.stoppedAtLimit).toBe(false);
  });

  it("reports both stops when the cap and the limit are reached at once", async () => {
    const ata = Keypair.generate().publicKey;
    const signatures = Array.from({ length: 60 }, (_, i) => entry(`sig${i}`, i));
    const transactions: Record<string, unknown> = {};
    for (let i = 0; i < 60; i += 1) {
      transactions[`sig${i}`] = parsedTx({
        signature: `sig${i}`,
        memo: `cookiejar:1|INV-${i}|note`,
        keys: [SENDER, JAR],
        preBalances: [10_000_000, 0],
        postBalances: [9_000_000, 1_000_000],
        blockTime: 1_760_000_000 - i,
      });
    }

    const history = await fetchJarHistory(
      connectionFor({
        signatures: { [JAR.toBase58()]: noise(1200), [ata.toBase58()]: signatures },
        transactions,
        tokenAccounts: [ata],
      }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(50);
    expect(history.hitCap).toBe(true);
    expect(history.stoppedAtLimit).toBe(true);
  });

  it("reads a wallet-only jar up to the cap and says so", async () => {
    const history = await fetchJarHistory(
      connectionFor({ signatures: { [JAR.toBase58()]: noise(1200) }, transactions: {} }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(0);
    expect(history.hitCap).toBe(true);
    expect(history.stoppedAtLimit).toBe(false);
  });

  it("reads at most thirty token accounts alongside the wallet", async () => {
    const tokenAccounts = Array.from({ length: 35 }, () => Keypair.generate().publicKey);
    const connection = connectionFor({ signatures: {}, transactions: {}, tokenAccounts });

    await fetchJarHistory(connection, JAR, 50);

    const asked = new Set(
      (connection as unknown as { getSignaturesForAddress: { mock: { calls: [PublicKey][] } } })
        .getSignaturesForAddress.mock.calls.map(([address]) => address.toBase58()),
    );
    expect(asked.size).toBe(MAX_TOKEN_ACCOUNTS + 1);
    expect(asked.has(JAR.toBase58())).toBe(true);
  });
});

describe("a jar holding one mint in two accounts", () => {
  /** The payment credits 2 into the auxiliary account; the associated account is untouched at 5. */
  function twoAccountTx(order: "ata-first" | "aux-first"): unknown {
    const ata = { accountIndex: 2, owner: JAR.toBase58(), mint: TOKEN_MINT, amount: "5" };
    const aux = { accountIndex: 3, owner: JAR.toBase58(), mint: TOKEN_MINT, amount: "10" };
    return parsedTx({
      signature: "sig0",
      memo: "cookiejar:1|INV-1|two accounts",
      keys: [SENDER, JAR, Keypair.generate().publicKey, Keypair.generate().publicKey],
      preTokenBalances: order === "ata-first" ? [ata, aux] : [aux, ata],
      postTokenBalances: [
        ata,
        { accountIndex: 3, owner: JAR.toBase58(), mint: TOKEN_MINT, amount: "12" },
      ],
    });
  }

  it("records the amount that arrived, whichever order the RPC lists the balances in", async () => {
    const read = async (order: "ata-first" | "aux-first") =>
      fetchJarHistory(
        connectionFor({
          signatures: { [JAR.toBase58()]: [entry("sig0", 0)] },
          transactions: { sig0: twoAccountTx(order) },
        }),
        JAR,
        50,
      );

    for (const order of ["ata-first", "aux-first"] as const) {
      const history = await read(order);
      expect(history.payments).toHaveLength(1);
      expect(history.payments[0]?.rawAmount).toBe(2n);
    }
  });
});

describe("a jar with more payments than the page asks for", () => {
  it("says it is showing the latest ones rather than reporting a short total", async () => {
    const signatures = Array.from({ length: 60 }, (_, i) => entry(`sig${i}`, i));
    const transactions: Record<string, unknown> = {};
    for (let i = 0; i < 60; i += 1) {
      transactions[`sig${i}`] = parsedTx({
        signature: `sig${i}`,
        memo: `cookiejar:1|INV-${i}|note`,
        keys: [SENDER, JAR],
        preBalances: [10_000_000, 0],
        postBalances: [9_000_000, 1_000_000],
        blockTime: 1_760_000_000 - i,
      });
    }

    const history = await fetchJarHistory(
      connectionFor({ signatures: { [JAR.toBase58()]: signatures }, transactions }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(50);
    expect(history.stoppedAtLimit).toBe(true);
    expect(history.hitCap).toBe(false);
  });

  it("keeps both rows of the transaction it stops on", async () => {
    const ordered = [
      parsedTx({
        signature: "sig-first",
        memo: "cookiejar:1|INV-1|COOK only",
        keys: [SENDER, JAR],
        preBalances: [10_000_000, 0],
        postBalances: [9_000_000, 1_000_000],
      }),
      parsedTx({
        signature: "sig-second",
        memo: "cookiejar:1|INV-2|both at once",
        keys: [SENDER, JAR, Keypair.generate().publicKey],
        preBalances: [10_000_000, 0, 0],
        postBalances: [8_000_000, 2_000_000, 0],
        postTokenBalances: [
          { accountIndex: 2, owner: JAR.toBase58(), mint: TOKEN_MINT, amount: "500" },
        ],
      }),
    ];

    const history = await fetchJarHistory(
      connectionFor({
        signatures: { [JAR.toBase58()]: [entry("sig-first", 0), entry("sig-second", 1)] },
        transactions: { "sig-first": ordered[0], "sig-second": ordered[1] },
      }),
      JAR,
      2,
    );

    // Two payments were asked for and the second transaction pays in two assets: its rows stay
    // together rather than one of them being cut off the end of the list.
    expect(history.payments).toHaveLength(3);
    const second = history.payments.filter((p) => p.signature === "sig-second");
    expect(second.map((p) => p.mint).sort()).toEqual([COOK_MINT, TOKEN_MINT].sort());
    expect(history.stoppedAtLimit).toBe(false);
  });

  it("reads the newest candidate first when the RPC reports no block time for it", async () => {
    const newest: SignatureEntry = {
      signature: "sig-new",
      err: null,
      memo: "[0] cookiejar:1|INV-9|newest",
      blockTime: null,
      slot: 1_000,
    };
    const older = entry("sig-old", 5);

    const history = await fetchJarHistory(
      connectionFor({
        signatures: { [JAR.toBase58()]: [newest, older] },
        transactions: {
          "sig-new": parsedTx({
            signature: "sig-new",
            memo: "cookiejar:1|INV-9|newest",
            keys: [SENDER, JAR],
            preBalances: [10_000_000, 0],
            postBalances: [9_000_000, 1_000_000],
            blockTime: null,
          }),
          "sig-old": parsedTx({
            signature: "sig-old",
            memo: "cookiejar:1|INV-5|older",
            keys: [SENDER, JAR],
            preBalances: [10_000_000, 0],
            postBalances: [9_500_000, 500_000],
          }),
        },
      }),
      JAR,
      1,
    );

    expect(history.payments).toHaveLength(1);
    expect(history.payments[0]?.signature).toBe("sig-new");
    expect(history.stoppedAtLimit).toBe(true);
  });

  it("stops at the end of a short history without claiming there is more", async () => {
    const signatures = [entry("sig0", 0)];
    const transactions = {
      sig0: parsedTx({
        signature: "sig0",
        memo: "cookiejar:1|INV-0|note",
        keys: [SENDER, JAR],
        preBalances: [10_000_000, 0],
        postBalances: [9_000_000, 1_000_000],
      }),
    };

    const history = await fetchJarHistory(
      connectionFor({ signatures: { [JAR.toBase58()]: signatures }, transactions }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(1);
    expect(history.stoppedAtLimit).toBe(false);
    expect(history.hitCap).toBe(false);
  });
});

describe("transactions with multiple memo instructions", () => {
  it("lists a transaction whose real memo follows a relayer memo", async () => {
    const signatures = [entry("sig-prepended", 0)];
    const transactions = {
      "sig-prepended": parsedTx({
        signature: "sig-prepended",
        memos: ["sent from SomeWallet", "cookiejar:1|INV-9|a real payment"],
        keys: [SENDER, JAR],
        preBalances: [10_000_000, 0],
        postBalances: [9_000_000, 1_000_000],
      }),
    };

    const history = await fetchJarHistory(
      connectionFor({ signatures: { [JAR.toBase58()]: signatures }, transactions }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(1);
    expect(history.payments[0]?.ref).toBe("INV-9");
  });

  it("does not list a transaction whose only memo is from a third party", async () => {
    const signatures = [
      {
        signature: "sig-thirdparty",
        err: null,
        memo: "[0] sent from SomeWallet",
        blockTime: 1_760_000_000,
        slot: 1_000,
      },
    ];
    const transactions = {
      "sig-thirdparty": parsedTx({
        signature: "sig-thirdparty",
        memos: ["sent from SomeWallet"],
        keys: [SENDER, JAR],
        preBalances: [10_000_000, 0],
        postBalances: [9_000_000, 1_000_000],
      }),
    };

    const history = await fetchJarHistory(
      connectionFor({ signatures: { [JAR.toBase58()]: signatures }, transactions }),
      JAR,
      50,
    );

    expect(history.payments).toHaveLength(0);
  });
});

describe("concurrency of signature queries across many accounts", () => {
  it("caps parallel getSignaturesForAddress calls to PARALLEL_PAGES", async () => {
    const accounts = Array.from({ length: 12 }, () => Keypair.generate().publicKey);
    let inFlight = 0;
    let maxInFlight = 0;
    const queried = new Set<string>();

    const connection = {
      getTokenAccountsByOwner: vi.fn(async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
        value: filter.programId.equals(TOKEN_PROGRAM_ID)
          ? accounts.map((pubkey) => ({
              pubkey,
              account: { data: Buffer.alloc(165) },
            }))
          : [],
      })),
      getSignaturesForAddress: vi.fn(async (address: PublicKey) => {
        queried.add(address.toBase58());
        inFlight += 1;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise((r) => setTimeout(r, 0));
        inFlight -= 1;
        return [];
      }),
      getParsedTransactions: vi.fn(async () => []),
    } as never;

    await fetchJarHistory(connection, JAR, 40);

    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(queried.size).toBe(13); // jar + 12 token accounts
    for (const acc of [JAR, ...accounts]) {
      expect(queried.has(acc.toBase58())).toBe(true);
    }
  });
});

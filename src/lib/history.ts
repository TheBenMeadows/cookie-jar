import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Connection, ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { COOK_DECIMALS, COOK_MINT, COOK_SYMBOL, MEMO_PROGRAM_ID } from "./config";
import { MEMO_PREFIX, parseMemo } from "./request";

/**
 * A jar's history, rebuilt from chain data alone. No database and no indexer: `getSignaturesForAddress`
 * lists what touched an address, and each transaction's own balance deltas say what arrived. The
 * memo is the filter — a transfer without the Cookie Tab prefix was not a Cookie Tab payment, and is
 * left out rather than guessed at.
 *
 * A jar is more than one address. Native COOK lands on the wallet, but an SPL transfer lands on a
 * token account the wallet owns, and the two index separately, so the wallet and every token account
 * under it are scanned and their signatures merged.
 */

export interface JarPayment {
  signature: string;
  blockTime: number | null;
  from: string | null;
  /** Base units received by the jar. */
  rawAmount: bigint;
  mint: string;
  decimals: number;
  symbol: string;
  ref: string | null;
  note: string | null;
}

const BATCH = 25;

/**
 * Reads every Memo-program instruction in a transaction and returns the first memo that parses
 * as a Cookie Tab payment. A wallet or relayer memo earlier in the transaction is ignored.
 */
function memoText(tx: ParsedTransactionWithMeta): string | null {
  const memoProgram = MEMO_PROGRAM_ID.toBase58();
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  const memos: string[] = [];
  for (const ix of instructions) {
    if (ix.programId.toBase58() !== memoProgram) continue;
    if ("parsed" in ix && typeof ix.parsed === "string") {
      memos.push(ix.parsed);
    } else if ("data" in ix && typeof ix.data === "string") {
      // The RPC parses Memo instructions into `parsed`, so this branch only runs against a node
      // whose parser is older than the memo program version in use. Undecoded data is base58.
      try {
        memos.push(new TextDecoder().decode(bs58.decode(ix.data)));
      } catch {
        continue;
      }
    }
  }
  for (const memo of memos) {
    if (parseMemo(memo)) return memo;
  }
  return null;
}

/** Native COOK received by `jar` in this transaction, in lamports. Negative or zero means nothing came in. */
function nativeReceived(tx: ParsedTransactionWithMeta, jar: string): bigint {
  const keys = tx.transaction.message.accountKeys;
  const index = keys.findIndex((k) => k.pubkey.toBase58() === jar);
  if (index < 0 || !tx.meta) return 0n;
  const before = tx.meta.preBalances[index];
  const after = tx.meta.postBalances[index];
  if (before === undefined || after === undefined) return 0n;
  const delta = BigInt(after) - BigInt(before);
  return delta > 0n ? delta : 0n;
}

interface TokenReceipt {
  mint: string;
  decimals: number;
  raw: bigint;
}

/**
 * SPL tokens received by `jar`, read from the transaction's own token-balance deltas.
 *
 * Balances are matched by account index rather than by mint: a wallet can hold one mint in several
 * accounts, and comparing an account's post-balance against another account's pre-balance reports a
 * receipt that never happened. One row per mint, summed across the accounts that gained.
 */
function tokensReceived(tx: ParsedTransactionWithMeta, jar: string): TokenReceipt[] {
  if (!tx.meta) return [];
  const before = new Map<number, bigint>();
  for (const balance of tx.meta.preTokenBalances ?? []) {
    if (balance.owner !== jar) continue;
    before.set(balance.accountIndex, BigInt(balance.uiTokenAmount.amount));
  }
  const receipts = new Map<string, TokenReceipt>();
  for (const balance of tx.meta.postTokenBalances ?? []) {
    if (balance.owner !== jar) continue;
    const delta = BigInt(balance.uiTokenAmount.amount) - (before.get(balance.accountIndex) ?? 0n);
    if (delta <= 0n) continue;
    const existing = receipts.get(balance.mint);
    if (existing) existing.raw += delta;
    else receipts.set(balance.mint, {
      mint: balance.mint,
      decimals: balance.uiTokenAmount.decimals,
      raw: delta,
    });
  }
  return [...receipts.values()];
}

function payerOf(tx: ParsedTransactionWithMeta): string | null {
  return tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? null;
}

/** How many signatures a single `getSignaturesForAddress` call asks for. */
const PAGE = 100;

/** How many signature pages a single round requests at once. */
const PARALLEL_PAGES = 6;

/**
 * The point at which a jar stops digging, shared across every address it owns. A busy address can
 * hold far more history than this.
 */
export const SCAN_CAP = 1000;

export interface JarHistory {
  payments: JarPayment[];
  /** How many signatures were read to find them, across every address a jar owns. */
  scanned: number;
  /** True when the cap ran out with an address still unread to its end. */
  hitCap: boolean;
  /** True when the scan stopped at `limit` payments with candidates left unfetched. */
  stoppedAtLimit: boolean;
  /**
   * True when the oldest signature read sits close enough to the node's earliest retained block
   * that the jar's history runs to the edge of what this RPC keeps. Reading every signature the
   * node returns is not the same as reading the jar's whole life, and on a jar older than the
   * retention window the two look identical from here.
   */
  reachedRetentionFloor: boolean;
}

/**
 * How near the node's first available block an oldest signature has to be before the read counts
 * as having run into the retention floor. One day of slots at Cookie Chain's rate, which absorbs
 * the floor advancing between the two calls and during a slow read. The error it admits is calling
 * a fully-read jar uncertain, which costs a "no record" where "not paid" was available; the error
 * it prevents is calling a settled invoice unpaid.
 */
export const RETENTION_FLOOR_MARGIN_SLOTS = 216_000;

/** A signature worth fetching, and what it takes to put it in chronological order. */
interface Candidate {
  signature: string;
  blockTime: number | null;
  slot: number;
}

/** Base units sit at offset 64 of an SPL token account, in Token and in Token-2022 alike. */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;

/** How many of a jar's token accounts are read alongside its wallet. */
export const MAX_TOKEN_ACCOUNTS = 30;

function tokenAccountBalance(data: Uint8Array): bigint {
  if (data.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) return 0n;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(TOKEN_ACCOUNT_AMOUNT_OFFSET, true);
}

/**
 * Every address a jar's payments can land on: the wallet itself, plus the token accounts it owns
 * under either token program. A token transfer names the token account, not the wallet, so a jar
 * that read only its wallet would miss every SPL payment sent to an account it already had.
 *
 * A wallet can carry hundreds of token accounts left behind by airdrops, and each one costs a round
 * trip whether or not it ever held anything, so the list is capped. The accounts holding a balance
 * come first, largest first, since those are the ones a jar has been paid into; ties and empties are
 * ordered by address, so the same jar reads the same way twice.
 */
async function jarAddresses(connection: Connection, jar: PublicKey): Promise<PublicKey[]> {
  const owned = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getTokenAccountsByOwner(jar, { programId }).catch(() => null),
    ),
  );

  const accounts: { pubkey: PublicKey; balance: bigint }[] = [];
  for (const response of owned) {
    for (const { pubkey, account } of response?.value ?? []) {
      accounts.push({ pubkey, balance: tokenAccountBalance(new Uint8Array(account.data)) });
    }
  }
  accounts.sort((a, b) => {
    if (a.balance !== b.balance) return b.balance > a.balance ? 1 : -1;
    return a.pubkey.toBase58() < b.pubkey.toBase58() ? -1 : 1;
  });

  return [jar, ...accounts.slice(0, MAX_TOKEN_ACCOUNTS).map((a) => a.pubkey)];
}

/**
 * Read Cookie Tab payments into `jar`, paging back through the signatures of every address it owns
 * until `limit` payments are found or `SCAN_CAP` signatures have been read across all of them.
 *
 * Paging matters on an address that does anything besides receive payments: without it a jar with
 * forty trades on top of a payment shows nothing and looks empty, which is the one wrong answer a
 * jar can give. Transactions that failed on chain are dropped — a jar shows money that arrived.
 */
export async function fetchJarHistory(
  connection: Connection,
  jar: PublicKey,
  limit = 40,
): Promise<JarHistory> {
  const jarAddress = jar.toBase58();
  const [addresses, firstAvailableBlock] = await Promise.all([
    jarAddresses(connection, jar),
    // A node that will not say how far back it goes cannot be shown to have answered in full, so a
    // failure here reads as the floor being immediately underfoot rather than infinitely far away.
    connection.getFirstAvailableBlock().catch(() => Number.POSITIVE_INFINITY),
  ]);

  const candidates = new Map<string, Candidate>();
  const scans = addresses.map((address) => ({
    address,
    before: undefined as string | undefined,
    found: 0,
    done: false,
  }));
  let scanned = 0;

  // One page per address per round, the round's pages asked for together. Reading an address to its
  // own end before starting the next one would let a busy wallet spend the whole cap and leave its
  // token accounts unread, which is the case that loses every SPL payment a jar ever took. Sharing
  // the cap out each round also costs one round-trip per round rather than one per account.
  while (scanned < SCAN_CAP) {
    const active = scans.filter((scan) => !scan.done && scan.found < limit);
    if (active.length === 0) break;
    const share = Math.max(1, Math.floor((SCAN_CAP - scanned) / active.length));
    const pages: (Awaited<ReturnType<Connection["getSignaturesForAddress"]>>)[] = [];
    for (let i = 0; i < active.length; i += PARALLEL_PAGES) {
      const slice = active.slice(i, i + PARALLEL_PAGES);
      const slicePages = await Promise.all(
        slice.map((scan) =>
          connection.getSignaturesForAddress(scan.address, {
            limit: Math.min(PAGE, share),
            ...(scan.before ? { before: scan.before } : {}),
          }),
        ),
      );
      pages.push(...slicePages);
    }

    for (const [i, page] of pages.entries()) {
      const scan = active[i];
      if (!scan) continue;
      if (page.length === 0) {
        scan.done = true;
        continue;
      }
      scanned += page.length;
      scan.before = page[page.length - 1]?.signature;
      for (const entry of page) {
        if (entry.err !== null) continue;
        // The RPC summarises a transaction's memos here, so a transaction with no Cookie Tab memo
        // can be skipped without fetching it. A null summary means "not reported", not "no memo".
        if (entry.memo !== null && entry.memo !== undefined && !entry.memo.includes(MEMO_PREFIX)) {
          continue;
        }
        scan.found += 1;
        if (candidates.has(entry.signature)) continue;
        candidates.set(entry.signature, {
          signature: entry.signature,
          blockTime: entry.blockTime ?? null,
          slot: entry.slot,
        });
      }
    }
  }

  const stoppedAtCap = scans.some((scan) => !scan.done && scan.found < limit);

  // Signatures come back newest first per address, so an address's newest `limit` candidates are
  // enough: the newest `limit` overall cannot contain one that a single address already has `limit`
  // newer entries in front of. Merging them puts the whole jar back in one order — by slot, which
  // every entry carries and which only ever counts up, rather than by a block time the RPC can
  // report as null and which would then sort a recent payment behind older ones.
  const ordered = [...candidates.values()].sort((a, b) => b.slot - a.slot);

  const payments: JarPayment[] = [];
  // Counted in transactions rather than rows: one transaction can pay a jar in two assets, and its
  // rows are kept together. `limit` is the point at which a jar stops fetching, so the list can run
  // one transaction's worth past it rather than end halfway through a receipt.
  let read = 0;

  while (read < ordered.length && payments.length < limit) {
    const batch = ordered.slice(read, read + BATCH).map((c) => c.signature);
    const transactions = await connection.getParsedTransactions(batch, {
      maxSupportedTransactionVersion: 0,
    });
    for (const tx of transactions) {
      if (payments.length >= limit) break;
      read += 1;
      if (!tx || tx.meta?.err) continue;
      const memo = memoText(tx);
      if (!memo) continue;
      const parsed = parseMemo(memo);
      if (!parsed) continue;

      const from = payerOf(tx);
      const base = {
        signature: tx.transaction.signatures[0] ?? "",
        blockTime: tx.blockTime ?? null,
        from: from === jarAddress ? null : from,
        ref: parsed.ref,
        note: parsed.note,
      };

      for (const receipt of tokensReceived(tx, jarAddress)) {
        payments.push({
          ...base,
          rawAmount: receipt.raw,
          mint: receipt.mint,
          decimals: receipt.decimals,
          symbol: "",
        });
      }

      const native = nativeReceived(tx, jarAddress);
      if (native > 0n) {
        payments.push({
          ...base,
          rawAmount: native,
          mint: COOK_MINT,
          decimals: COOK_DECIMALS,
          symbol: COOK_SYMBOL,
        });
      }
    }
  }

  payments.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  // `ordered` is sorted newest first, so the last entry is the oldest signature the read reached.
  // A jar with nothing in the window has no oldest signature and no claim to have seen anything.
  const oldestSlot = ordered[ordered.length - 1]?.slot;
  return {
    payments,
    scanned,
    hitCap: stoppedAtCap,
    stoppedAtLimit: read < ordered.length,
    reachedRetentionFloor:
      oldestSlot === undefined || oldestSlot - firstAvailableBlock <= RETENTION_FLOOR_MARGIN_SLOTS,
  };
}

export interface JarTotal {
  mint: string;
  decimals: number;
  symbol: string;
  raw: bigint;
  count: number;
}

export function totalsByToken(payments: JarPayment[]): JarTotal[] {
  const totals = new Map<string, JarTotal>();
  for (const payment of payments) {
    const existing = totals.get(payment.mint);
    if (existing) {
      existing.raw += payment.rawAmount;
      existing.count += 1;
    } else {
      totals.set(payment.mint, {
        mint: payment.mint,
        decimals: payment.decimals,
        symbol: payment.symbol,
        raw: payment.rawAmount,
        count: 1,
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count);
}

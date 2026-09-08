import type { Connection, ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import { COOK_DECIMALS, COOK_MINT, COOK_SYMBOL, MEMO_PROGRAM_ID } from "./config";
import { MEMO_PREFIX, parseMemo } from "./request";

/**
 * A jar's history, rebuilt from chain data alone. No database and no indexer: `getSignaturesForAddress`
 * lists what touched the address, and each transaction's own balance deltas say what arrived. The
 * memo is the filter — a transfer without the Cookie Jar prefix was not a Cookie Jar payment, and is
 * left out rather than guessed at.
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function memoText(tx: ParsedTransactionWithMeta): string | null {
  const memoProgram = MEMO_PROGRAM_ID.toBase58();
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  for (const ix of instructions) {
    if (ix.programId.toBase58() !== memoProgram) continue;
    if ("parsed" in ix && typeof ix.parsed === "string") return ix.parsed;
    if ("data" in ix && typeof ix.data === "string") {
      // The RPC parses Memo instructions into `parsed`, so this branch only runs against a node
      // whose parser is older than the memo program version in use. Undecoded data is base58.
      try {
        return new TextDecoder().decode(bs58.decode(ix.data));
      } catch {
        return null;
      }
    }
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

/** SPL tokens received by `jar`, read from the transaction's own token-balance deltas. */
function tokensReceived(tx: ParsedTransactionWithMeta, jar: string): TokenReceipt[] {
  if (!tx.meta) return [];
  const before = new Map<string, bigint>();
  for (const balance of tx.meta.preTokenBalances ?? []) {
    if (balance.owner !== jar) continue;
    before.set(balance.mint, BigInt(balance.uiTokenAmount.amount));
  }
  const receipts: TokenReceipt[] = [];
  for (const balance of tx.meta.postTokenBalances ?? []) {
    if (balance.owner !== jar) continue;
    const delta = BigInt(balance.uiTokenAmount.amount) - (before.get(balance.mint) ?? 0n);
    if (delta > 0n) {
      receipts.push({ mint: balance.mint, decimals: balance.uiTokenAmount.decimals, raw: delta });
    }
  }
  return receipts;
}

function payerOf(tx: ParsedTransactionWithMeta): string | null {
  return tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? null;
}

/** How many signatures a single `getSignaturesForAddress` call asks for. */
const PAGE = 100;

/** The point at which a jar stops digging. A busy address can hold far more history than this. */
export const SCAN_CAP = 1000;

export interface JarHistory {
  payments: JarPayment[];
  /** How many signatures were read to find them. */
  scanned: number;
  /** True when the scan stopped at the cap rather than at the end of the address's history. */
  hitCap: boolean;
}

/**
 * Read Cookie Jar payments into `jar`, paging back through its signatures until `limit` are found or
 * `SCAN_CAP` signatures have been read.
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

  const candidates: string[] = [];
  let scanned = 0;
  let before: string | undefined;
  let exhausted = false;

  while (scanned < SCAN_CAP && candidates.length < limit) {
    const page = await connection.getSignaturesForAddress(jar, {
      limit: Math.min(PAGE, SCAN_CAP - scanned),
      ...(before ? { before } : {}),
    });
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    scanned += page.length;
    before = page[page.length - 1]?.signature;
    for (const entry of page) {
      if (entry.err !== null) continue;
      // The RPC summarises a transaction's memos here, so a transaction with no Cookie Jar memo can
      // be skipped without fetching it. A null summary means "not reported", not "no memo".
      if (entry.memo !== null && entry.memo !== undefined && !entry.memo.includes(MEMO_PREFIX)) {
        continue;
      }
      candidates.push(entry.signature);
      if (candidates.length >= limit) break;
    }
  }

  const hitCap = !exhausted && scanned >= SCAN_CAP && candidates.length < limit;
  if (candidates.length === 0) return { payments: [], scanned, hitCap };

  const payments: JarPayment[] = [];
  for (const batch of chunk(candidates, BATCH)) {
    const transactions = await connection.getParsedTransactions(batch, {
      maxSupportedTransactionVersion: 0,
    });
    for (const tx of transactions) {
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
  return { payments, scanned, hitCap };
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

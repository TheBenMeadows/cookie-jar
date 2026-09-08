import { Buffer } from "buffer";
import { PublicKey, type Connection, type VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { CANDYSHOP_API, COOKIEBOX_AGG_API, COOK_MINT, DEFAULT_SLIPPAGE_BPS } from "./config";
import { fetchJson, HttpError } from "./http";

/**
 * The optional swap step. A payer who holds some other Cookie Chain token but not the one an invoice
 * asks for gets a quote here, swaps, and then pays — two transactions, both theirs, neither
 * custodial.
 *
 * Two aggregators cover the chain's liquidity and they do not agree on routes, so both are asked and
 * the better output wins. Cookiebox is the router behind cookiebox.app; Candy Shop is the one behind
 * swap.cookiescan.io. Either can answer "no route", which is a real answer, not an error.
 */

export type Aggregator = "cookiebox" | "candyshop";

export interface SwapQuote {
  aggregator: Aggregator;
  inputMint: string;
  outputMint: string;
  /** Base units in and out. Strings, because these exceed what a double holds. */
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number | null;
  /** Venue names along the route, in order. */
  venues: string[];
  /** The aggregator's own site, for a payer who would rather finish the swap there. */
  swapUrl: string;
  /**
   * The router's own route object, handed back to it unchanged when the swap is built. Opaque here
   * on purpose: reshaping it would mean re-deriving a route this app did not compute.
   */
  route: unknown;
}

interface AggSegment {
  pool?: string;
  venue?: string;
  hopIndex?: number;
}

interface AggQuoteBody {
  route?: {
    inAmount?: string;
    outAmount?: string;
    netOutAmount?: string;
    minOutAmount?: string;
    priceImpactPct?: number | null;
    segments?: AggSegment[];
  };
}

interface CandyShopSegment {
  dex?: string;
  programName?: string;
  hopIndex?: number;
}

interface CandyShopQuoteBody {
  multiRoute?: {
    totalInAmount?: string;
    totalOutAmount?: string;
    minOutAmount?: string;
    combinedPriceImpactPct?: number;
    segments?: CandyShopSegment[];
  };
}

const COOKIEBOX_SWAP_URL = "https://cookiebox.app";
const CANDYSHOP_SWAP_URL = "https://swap.cookiescan.io";

function isNoRoute(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 404 || error.status === 400);
}

async function quoteCookiebox(
  inputMint: string,
  outputMint: string,
  rawAmount: string,
  slippageBps: number,
): Promise<SwapQuote | null> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: rawAmount,
    slippageBps: String(slippageBps),
  });
  let body: AggQuoteBody;
  try {
    body = await fetchJson<AggQuoteBody>(`${COOKIEBOX_AGG_API}/quote?${params}`);
  } catch (error) {
    if (isNoRoute(error)) return null;
    throw error;
  }
  const route = body.route;
  if (!route?.inAmount || !route.outAmount) return null;
  const out = route.netOutAmount ?? route.outAmount;
  return {
    aggregator: "cookiebox",
    inputMint,
    outputMint,
    inAmount: route.inAmount,
    outAmount: out,
    minOutAmount: route.minOutAmount ?? out,
    priceImpactPct: route.priceImpactPct ?? null,
    venues: (route.segments ?? []).map((s) => s.venue ?? "unknown"),
    swapUrl: COOKIEBOX_SWAP_URL,
    route,
  };
}

async function quoteCandyShop(
  inputMint: string,
  outputMint: string,
  rawAmount: string,
  slippageBps: number,
): Promise<SwapQuote | null> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: rawAmount,
    slippageBps: String(slippageBps),
  });
  let body: CandyShopQuoteBody;
  try {
    body = await fetchJson<CandyShopQuoteBody>(`${CANDYSHOP_API}/quote/multi-route?${params}`);
  } catch (error) {
    if (isNoRoute(error)) return null;
    throw error;
  }
  const route = body.multiRoute;
  if (!route?.totalInAmount || !route.totalOutAmount) return null;
  return {
    aggregator: "candyshop",
    inputMint,
    outputMint,
    inAmount: route.totalInAmount,
    outAmount: route.totalOutAmount,
    minOutAmount: route.minOutAmount ?? route.totalOutAmount,
    priceImpactPct:
      typeof route.combinedPriceImpactPct === "number" && Number.isFinite(route.combinedPriceImpactPct)
        ? route.combinedPriceImpactPct
        : null,
    venues: (route.segments ?? []).map((s) => s.programName ?? s.dex ?? "unknown"),
    swapUrl: CANDYSHOP_SWAP_URL,
    route,
  };
}

/** Quote one named aggregator. Returns null when that router has no route for the pair. */
export async function quoteFrom(
  aggregator: Aggregator,
  args: { inputMint: string; outputMint: string; rawAmount: string; slippageBps?: number },
): Promise<SwapQuote | null> {
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const quote = aggregator === "cookiebox" ? quoteCookiebox : quoteCandyShop;
  return quote(args.inputMint, args.outputMint, args.rawAmount, slippageBps);
}

/**
 * Ask both aggregators and keep the larger output. A rejection from one is not a failure — Cookie
 * Chain's liquidity is thin enough that a token with a route on one router often has none on the
 * other. Only a pair with no route anywhere returns null.
 */
export async function bestSwapQuote(args: {
  inputMint: string;
  outputMint: string;
  /** Input amount in base units. */
  rawAmount: string;
  slippageBps?: number;
}): Promise<SwapQuote | null> {
  const { inputMint, outputMint, rawAmount } = args;
  if (inputMint === outputMint) return null;
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  const results = await Promise.allSettled([
    quoteCookiebox(inputMint, outputMint, rawAmount, slippageBps),
    quoteCandyShop(inputMint, outputMint, rawAmount, slippageBps),
  ]);

  const quotes = results
    .filter((r): r is PromiseFulfilledResult<SwapQuote | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((q): q is SwapQuote => q !== null);

  // A router answering with a decimal or an empty string is dropped rather than compared: BigInt
  // throws on anything that is not a whole number, and one bad quote must not lose the other.
  const usable = quotes.filter((q) => /^\d+$/.test(q.outAmount) && /^\d+$/.test(q.minOutAmount));
  if (usable.length === 0) return null;
  return usable.reduce((best, q) => (BigInt(q.outAmount) > BigInt(best.outAmount) ? q : best));
}

// --- Executing a swap -----------------------------------------------------------------------------

export interface BuiltSwap {
  /** An unsigned v0 transaction, fee payer already set to the swapper's own wallet. */
  transactionBase64: string;
}

/** A build can take several confirmations server-side, so it gets a much longer deadline than a quote. */
const BUILD_TIMEOUT_MS = 60_000;

/**
 * Ask Cookiebox to build the swap. It re-quotes server-side and answers with an unsigned versioned
 * transaction whose fee payer is the payer's own wallet: Cookie Jar never holds the funds, never
 * signs, and never sees a key. The caller simulates it, has the wallet sign it, and sends it.
 */
export async function buildCookieboxSwap(args: {
  inputMint: string;
  outputMint: string;
  rawAmount: string;
  owner: string;
  slippageBps?: number;
}): Promise<BuiltSwap & { blockhash?: string; lastValidBlockHeight?: number }> {
  return fetchJson<BuiltSwap & { blockhash?: string; lastValidBlockHeight?: number }>(
    `${COOKIEBOX_AGG_API}/swap-tx`,
    {
      method: "POST",
      timeoutMs: BUILD_TIMEOUT_MS,
      body: JSON.stringify({
        inputMint: args.inputMint,
        outputMint: args.outputMint,
        amount: args.rawAmount,
        slippageBps: args.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
        owner: args.owner,
      }),
    },
  );
}

/** Candy Shop builds from the route it quoted, handed back unchanged. */
async function buildCandyShopSwap(route: unknown, owner: string): Promise<BuiltSwap> {
  return fetchJson<BuiltSwap>(`${CANDYSHOP_API}/swap-tx/multi-route`, {
    method: "POST",
    timeoutMs: BUILD_TIMEOUT_MS,
    body: JSON.stringify({ multiRoute: route, userPublicKey: owner }),
  });
}

/**
 * Build whichever quote won. Each aggregator builds its own route: handing a Cookiebox route to
 * Candy Shop, or the reverse, would ask one router to execute a path the other found.
 */
export async function buildSwapTransaction(quote: SwapQuote, owner: string): Promise<BuiltSwap> {
  if (quote.aggregator === "candyshop") return buildCandyShopSwap(quote.route, owner);
  return buildCookieboxSwap({
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    rawAmount: quote.inAmount,
    owner,
  });
}

// --- Checking a swap before it is signed ----------------------------------------------------------

/**
 * The aggregator builds the transaction; this app has to decide whether to put it in front of a
 * wallet. A router is a third party, and "it simulated" is not the same as "it does what the quote
 * said" — a transaction can succeed on chain and still move the payer's tokens somewhere else.
 *
 * Three things are checked, in the order that a failure is cheapest to explain:
 *   1. the payer is the fee payer and the only required signer, so nothing else is being co-signed;
 *   2. it simulates clean;
 *   3. the payer's own balances move the way the quote promised — at least the minimum out arrives,
 *      and nothing except the token being sold goes down.
 */

/** Base units sit at offset 64 of an SPL token account, in Token and in Token-2022 alike. */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;

/**
 * Room for the network fee and for rent on a token account the swap may open, both of which come out
 * of a native-token balance and are not part of what the quote promised. 0.01 COOK covers a handful
 * of signatures plus one account's rent.
 */
const NATIVE_OVERHEAD_ALLOWANCE = 10_000_000n;

export interface SwapVerification {
  ok: boolean;
  /** Why the transaction was refused. Null when it passed. */
  reason: string | null;
  /** What the simulation says the payer actually receives, in base units. */
  expectedOutRaw: bigint | null;
}

function readTokenAmount(data: Uint8Array): bigint | null {
  if (data.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(TOKEN_ACCOUNT_AMOUNT_OFFSET, true);
}

export async function verifySwapTransaction(args: {
  connection: Connection;
  transaction: VersionedTransaction;
  owner: PublicKey;
  quote: SwapQuote;
}): Promise<SwapVerification> {
  const { connection, transaction, owner, quote } = args;
  const message = transaction.message;

  const feePayer = message.staticAccountKeys[0];
  if (!feePayer || !feePayer.equals(owner)) {
    return {
      ok: false,
      reason: `the router built a transaction paid for by ${feePayer?.toBase58() ?? "nobody"} rather than by this wallet`,
      expectedOutRaw: null,
    };
  }
  if (message.header.numRequiredSignatures !== 1) {
    return {
      ok: false,
      reason: `this transaction needs ${message.header.numRequiredSignatures} signatures; a swap from this wallet needs one`,
      expectedOutRaw: null,
    };
  }

  // Every token account this wallet owns, so a decrease anywhere is visible rather than only in the
  // two accounts the route names.
  const owned = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getTokenAccountsByOwner(owner, { programId }).catch(() => null),
    ),
  );

  interface Watched {
    address: PublicKey;
    mint: string;
    before: bigint;
  }
  const watched: Watched[] = [];
  for (const response of owned) {
    for (const { pubkey, account } of response?.value ?? []) {
      const data = new Uint8Array(account.data);
      const amount = readTokenAmount(data);
      if (amount === null) continue;
      const mint = new PublicKey(data.subarray(0, 32)).toBase58();
      watched.push({ address: pubkey, mint, before: amount });
    }
  }

  const nativeOut = quote.outputMint === COOK_MINT;
  const lamportsBefore = BigInt(await connection.getBalance(owner));

  const addresses = [...watched.map((w) => w.address.toBase58()), owner.toBase58()].slice(0, 60);
  const simulation = await connection.simulateTransaction(transaction, {
    replaceRecentBlockhash: true,
    sigVerify: false,
    accounts: { encoding: "base64", addresses },
  });

  if (simulation.value.err) {
    return {
      ok: false,
      reason: `the swap did not simulate: ${simulation.value.logs?.slice(-2).join(" | ") ?? JSON.stringify(simulation.value.err)}`,
      expectedOutRaw: null,
    };
  }

  const post = simulation.value.accounts ?? [];
  let outDelta: bigint | null = null;

  for (let i = 0; i < watched.length && i < addresses.length; i += 1) {
    const entry = watched[i];
    const account = post[i];
    if (!entry) continue;
    // A null slot means the simulation did not return that account; treat it as unchanged rather
    // than as a decrease, because an absent reading is not evidence of a loss.
    if (!account) continue;
    const raw = Array.isArray(account.data) ? account.data[0] : null;
    if (typeof raw !== "string") continue;
    const after = readTokenAmount(new Uint8Array(Buffer.from(raw, "base64")));
    if (after === null) continue;

    const delta = after - entry.before;
    if (entry.mint === quote.outputMint) {
      outDelta = (outDelta ?? 0n) + (delta > 0n ? delta : 0n);
    } else if (entry.mint !== quote.inputMint && delta < 0n) {
      return {
        ok: false,
        reason: `this transaction also takes ${-delta} base units of ${entry.mint} out of this wallet, which the quote did not mention`,
        expectedOutRaw: null,
      };
    }
  }

  if (nativeOut) {
    const ownerAccount = post[addresses.length - 1];
    if (ownerAccount) {
      const after = BigInt(ownerAccount.lamports);
      outDelta = after - lamportsBefore + NATIVE_OVERHEAD_ALLOWANCE;
    }
  }

  const minOut = BigInt(quote.minOutAmount);
  if (outDelta === null) {
    return {
      ok: false,
      reason: "the simulation did not show this wallet receiving the token it is swapping into",
      expectedOutRaw: null,
    };
  }
  if (outDelta < minOut) {
    return {
      ok: false,
      reason: `the quote promised at least ${minOut} base units out; the simulation delivers ${outDelta}`,
      expectedOutRaw: outDelta,
    };
  }

  return { ok: true, reason: null, expectedOutRaw: outDelta };
}

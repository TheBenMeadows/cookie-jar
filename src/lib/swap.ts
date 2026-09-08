import { CANDYSHOP_API, COOKIEBOX_AGG_API, DEFAULT_SLIPPAGE_BPS } from "./config";
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

  if (quotes.length === 0) return null;
  return quotes.reduce((best, q) => (BigInt(q.outAmount) > BigInt(best.outAmount) ? q : best));
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

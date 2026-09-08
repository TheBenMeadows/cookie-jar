import { COOKIESCAN_API, COOK_DECIMALS, COOK_MINT, COOK_SYMBOL } from "./config";
import { fetchJson } from "./http";

/**
 * Cookiescan's token registry and price feed. Cookie Jar reads it for three things: the USD value of
 * an amount, the decimals of a token a merchant picks, and the ticker shown next to a number. None
 * of it is ever used for arithmetic on a transaction — decimals come from the registry, amounts come
 * from the payer, and both are converted with BigInt.
 */

export interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  logo: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
}

interface CookiescanTokenPayload {
  mint?: string;
  metadata?: {
    name?: string;
    symbol?: string;
    logo?: string | null;
    decimals?: number;
  };
  price?: { usd?: number | string | null };
  marketData?: { liquidity?: number | null };
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function toTokenInfo(payload: CookiescanTokenPayload): TokenInfo | null {
  const mint = payload.mint;
  const decimals = payload.metadata?.decimals;
  if (typeof mint !== "string" || typeof decimals !== "number") return null;
  return {
    mint,
    name: payload.metadata?.name ?? "Unknown token",
    symbol: payload.metadata?.symbol ?? "?",
    decimals,
    logo: payload.metadata?.logo ?? null,
    priceUsd: toNumber(payload.price?.usd),
    liquidityUsd: toNumber(payload.marketData?.liquidity),
  };
}

export const COOK_TOKEN: TokenInfo = {
  mint: COOK_MINT,
  name: "Cookie",
  symbol: COOK_SYMBOL,
  decimals: COOK_DECIMALS,
  logo: null,
  priceUsd: null,
  liquidityUsd: null,
};

/** One token by mint. `cook` is accepted as an alias for the native token. */
export async function fetchToken(mint: string): Promise<TokenInfo | null> {
  const body = await fetchJson<{ success?: boolean; data?: CookiescanTokenPayload }>(
    `${COOKIESCAN_API}/api/price/${encodeURIComponent(mint)}`,
  );
  return body.data ? toTokenInfo(body.data) : null;
}

/** COOK's dollar price. Returns null rather than throwing: a missing price hides a figure, not a page. */
export async function fetchCookPriceUsd(): Promise<number | null> {
  try {
    const token = await fetchToken("cook");
    return token?.priceUsd ?? null;
  } catch {
    return null;
  }
}

/**
 * Token search for the Create form. Cookiescan matches loosely and answers with hundreds of rows, so
 * the results are sorted by liquidity — a merchant asking for "trash" wants the pair people actually
 * trade, not the first row of a name match.
 */
export async function searchTokens(query: string, limit = 12): Promise<TokenInfo[]> {
  const q = query.trim();
  if (q === "") return [];
  const body = await fetchJson<{ data?: CookiescanTokenPayload[] }>(
    `${COOKIESCAN_API}/api/tokens/search?q=${encodeURIComponent(q)}`,
  );
  const tokens = (body.data ?? [])
    .map(toTokenInfo)
    .filter((t): t is TokenInfo => t !== null)
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  return tokens.slice(0, limit);
}

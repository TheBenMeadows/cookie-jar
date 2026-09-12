import { COOKIESCAN_API, COOK_DECIMALS, COOK_MINT, COOK_SYMBOL } from "./config";
import { fetchJson } from "./http";

/**
 * Cookiescan's token registry and price feed. Cookie Tab reads it for three things: the USD value of
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

/**
 * The native token before its price has been read. Every field here is a local constant, because the
 * mint and the decimals decide how a transfer is built and must never come from a network answer.
 * The price starts null and is filled in by `fetchNativeToken`.
 */
export const COOK_TOKEN: TokenInfo = {
  mint: COOK_MINT,
  name: "Cookie",
  symbol: COOK_SYMBOL,
  decimals: COOK_DECIMALS,
  logo: null,
  priceUsd: null,
  liquidityUsd: null,
};

interface CookiescanAsset {
  assetId?: string;
  name?: string;
  symbol?: string;
  stats?: { price?: number | string | null; liquidity?: number | null };
}

/**
 * COOK from the canonical asset registry rather than from a mint lookup.
 *
 * COOK exists on Cookie Chain under three mints: the native gas token, the wrapped `So111…112` form
 * and the bridged Solana mint. `/v1/assets/cook` resolves all three to one entry with one price,
 * which is the figure a merchant means by "the COOK price". Only the price and the liquidity are
 * taken from it — the mint and the decimals stay local, so a change on Cookiescan's side can never
 * alter how a transfer is built.
 */
export async function fetchNativeToken(): Promise<TokenInfo> {
  const asset = await fetchJson<CookiescanAsset>(`${COOKIESCAN_API}/v1/assets/cook`);
  return {
    ...COOK_TOKEN,
    priceUsd: toNumber(asset.stats?.price),
    liquidityUsd: toNumber(asset.stats?.liquidity),
  };
}

/**
 * One token by mint. The native token and its wrapped mint both route to the asset registry; every
 * other mint is read from the price endpoint.
 */
export async function fetchToken(mint: string): Promise<TokenInfo | null> {
  if (mint === COOK_MINT || mint === "cook") return fetchNativeToken();
  const body = await fetchJson<{ success?: boolean; data?: CookiescanTokenPayload }>(
    `${COOKIESCAN_API}/api/price/${encodeURIComponent(mint)}`,
  );
  return body.data ? toTokenInfo(body.data) : null;
}

/** COOK's dollar price. Returns null rather than throwing: a missing price hides a figure, not a page. */
export async function fetchCookPriceUsd(): Promise<number | null> {
  try {
    return (await fetchNativeToken()).priceUsd;
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

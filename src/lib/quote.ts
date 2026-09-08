import { uiToRaw } from "./format";

/**
 * Dollar-quoted requests. A merchant asks for "$25 of COOK" and the payer's page turns that into a
 * token amount at the Cookiescan price, in the browser, at the moment they open the link. Nothing is
 * pegged and nothing is escrowed: the price is a display convenience over a plain token transfer,
 * which is why the amount is recomputed and shown before the payer signs.
 */

/** Fixed-point scale for the price. Cookie Chain tokens trade near 1e-5 USD, so the scale is generous. */
const PRICE_SCALE = 1_000_000_000_000n;

export class QuoteError extends Error {}

export function usdToRaw(usd: string, priceUsd: number, decimals: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new QuoteError("this token has no price on Cookiescan, so a dollar amount cannot be quoted");
  }
  const scaledUsd = uiToRaw(usd, 12);
  const scaledPrice = BigInt(Math.round(priceUsd * Number(PRICE_SCALE)));
  if (scaledPrice <= 0n) {
    throw new QuoteError("this token's price rounds to zero, so a dollar amount cannot be quoted");
  }
  const raw = (scaledUsd * 10n ** BigInt(decimals)) / scaledPrice;
  if (raw <= 0n) throw new QuoteError("that dollar amount is smaller than one unit of this token");
  return raw;
}

export function rawToUsd(raw: bigint, priceUsd: number, decimals: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return Number.NaN;
  const scaledPrice = BigInt(Math.round(priceUsd * Number(PRICE_SCALE)));
  const scaledUsd = (raw * scaledPrice) / 10n ** BigInt(decimals);
  return Number(scaledUsd) / Number(PRICE_SCALE);
}

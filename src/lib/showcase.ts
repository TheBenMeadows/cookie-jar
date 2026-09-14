import type { PaymentRequest } from "./request";

/** The CookOven name the demo jar owns. Every published link names it rather than the base58 key. */
export const SHOWCASE_NAME = "cookietab.cook";

/** The demo jar itself, for reads that want the key without a name resolution. */
export const SHOWCASE_JAR = "5ZJsQcVGMqBbuiSQjRT1dBntDp3x8YbfWf359mPdEGwA";

/** TRASHCOIN: a token with real Cookie Chain liquidity, so a payer holding only COOK is short of it and takes the one-transaction swap-and-pay path. */
export const SHOWCASE_MINT = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";

/** Decimals of the TRASHCOIN showcase token. */
export const SHOWCASE_DECIMALS = 9;

/** Ticker symbol of the TRASHCOIN showcase token. */
export const SHOWCASE_SYMBOL = "TRASHCOIN";

/** About half a US dollar at the time it was set. Fixed in the token so no price feed sits in the hot path. */
export const SHOWCASE_AMOUNT = "700";

/** The reference the refresh job pays under, so a receipt for it is always inside the RPC window during judging. */
export const SHOWCASE_LANDED_REF = "LANDING-COMPOSED";

/** Every homepage payment carries a reference starting with this, followed by six characters from REF_ALPHABET. */
export const SHOWCASE_REF_PREFIX = "TAB-";

/** Label shown on the homepage demo payment request. */
export const SHOWCASE_LABEL = "Cookie Tab";

/** Note attached to the homepage payment request. */
export const SHOWCASE_NOTE = "the homepage invoice, paid from whatever you hold";

/** Crockford base32 without the letters that read like digits, so a reference survives being read aloud. */
export const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function fillRandom(bytes: Uint8Array): Uint8Array {
  return globalThis.crypto.getRandomValues(bytes);
}

/**
 * A reference no earlier payer has used, so each visitor's payment settles its own receipt instead
 * of stacking under a shared one. Six characters from a 32-letter alphabet is over a billion
 * references: the bytes come from `random`, which defaults to the platform CSPRNG and is injectable
 * for tests.
 */
export function freshRef(
  random: (bytes: Uint8Array) => Uint8Array = fillRandom,
): string {
  let ref = SHOWCASE_REF_PREFIX;
  for (const byte of random(new Uint8Array(6))) {
    ref += REF_ALPHABET.charAt(byte % REF_ALPHABET.length);
  }
  return ref;
}

/** The homepage invoice as a payment request, for `encodeRequest` and the Pay page. */
export function showcaseRequest(ref: string): PaymentRequest {
  return {
    to: SHOWCASE_NAME,
    label: SHOWCASE_LABEL,
    note: SHOWCASE_NOTE,
    amount: SHOWCASE_AMOUNT,
    mint: SHOWCASE_MINT,
    decimals: SHOWCASE_DECIMALS,
    symbol: SHOWCASE_SYMBOL,
    ref,
  };
}

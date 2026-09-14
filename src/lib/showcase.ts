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

/** Every homepage payment carries a reference starting with this, followed by REF_LENGTH characters from REF_ALPHABET. */
export const SHOWCASE_REF_PREFIX = "TAB-";

/**
 * Seven characters from a 32-letter alphabet is 35 bits, about 34 billion references. Every press
 * of the homepage button lands on the same jar, so this is a birthday problem across one demo's
 * traffic: at six characters the odds of two visitors sharing a receipt pass 4% by ten thousand
 * presses; at seven they stay under 0.2%. The seventh character costs nothing on a QR code.
 */
export const REF_LENGTH = 7;

/** Label shown on the homepage demo payment request. */
export const SHOWCASE_LABEL = "Cookie Tab";

/**
 * Written into the memo of every homepage payment, where it is public and permanent, so it says
 * only what stays true whatever token the payer held.
 */
export const SHOWCASE_NOTE = "Cookie Tab homepage invoice";

/** Crockford base32 without the letters that read like digits, so a reference survives being read aloud. */
export const REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function fillRandom(bytes: Uint8Array): Uint8Array {
  return globalThis.crypto.getRandomValues(bytes);
}

/**
 * A reference for this press of the button, so each visitor's payment settles its own receipt
 * instead of stacking under a shared one. Distinct with the odds above, not by construction: a
 * reference is public text, and two payments carrying the same one list together on one receipt.
 * The bytes come from `random`, which defaults to the platform CSPRNG and is injectable for tests;
 * 256 is a multiple of 32, so the modulo is unbiased.
 */
export function freshRef(
  random: (bytes: Uint8Array) => Uint8Array = fillRandom,
): string {
  let ref = SHOWCASE_REF_PREFIX;
  for (const byte of random(new Uint8Array(REF_LENGTH))) {
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

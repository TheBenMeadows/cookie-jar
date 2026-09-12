import { totalsByToken, type JarPayment, type JarTotal } from "./history";

/**
 * Matching payments to a request by reference. The memo's fixed `ref` field is what makes this
 * possible: a request's reference goes on chain with every payment of it, so the payments for an
 * invoice are the jar's payments carrying that reference, read back with no index and no server.
 *
 * A reference is written by whoever made the link and anyone can put the same string in a memo, so
 * a match is chain evidence that a payment carrying this reference reached this jar, not proof of
 * who sent it. The explorer link on each row is the thing to check when that matters.
 */

/** References compare after the same normalisation the memo applies: a `|` in a reference was written as `/`. */
export function normalizeRef(ref: string): string {
  return ref.replace(/\|/g, "/").trim();
}

/** Every payment in `payments` carrying `ref`, newest first as the jar lists them. */
export function paymentsForRef(payments: JarPayment[], ref: string): JarPayment[] {
  const wanted = normalizeRef(ref);
  if (wanted === "") return [];
  return payments.filter((p) => p.ref !== null && normalizeRef(p.ref) === wanted);
}

export type SettlementState = "unpaid" | "partial" | "paid";

export interface Settlement {
  state: SettlementState;
  /** Payments carrying the reference, in any token. */
  payments: JarPayment[];
  /** Base units received in the requested token across those payments. */
  paidRaw: bigint;
  /** What the request asked for, in base units of its token. */
  requestedRaw: bigint;
  /** Per-token totals across the matching payments, for a request paid in more than one token. */
  totals: JarTotal[];
}

/**
 * Whether a request for `requestedRaw` of `mint` has been paid, judged from the jar's payments.
 * Only payments in the requested token count toward the amount; a payment carrying the reference in
 * another token is listed but not summed, because there is no price here to compare it at.
 */
export function settlementOf(
  payments: JarPayment[],
  ref: string,
  mint: string,
  requestedRaw: bigint,
): Settlement {
  const matching = paymentsForRef(payments, ref);
  const paidRaw = matching
    .filter((p) => p.mint === mint)
    .reduce((sum, p) => sum + p.rawAmount, 0n);
  // An open request names no amount, so anything that arrived under its reference settles it.
  let state: SettlementState = "unpaid";
  if (paidRaw > 0n && paidRaw >= requestedRaw) state = "paid";
  else if (paidRaw > 0n) state = "partial";
  return { state, payments: matching, paidRaw, requestedRaw, totals: totalsByToken(matching) };
}

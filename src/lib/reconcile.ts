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

/**
 * `unknown` is the honest answer when nothing carrying the reference was found AND the jar's own
 * history could not be read to its end: a public Cookie Chain node keeps roughly ten days, so a
 * reference settled before that window reads exactly like one never paid. Calling that `unpaid`
 * would invite a second payment for an invoice already settled.
 */
export type SettlementState = "unknown" | "unpaid" | "partial" | "paid";

/** What the jar read could see, which decides whether an absence means anything. */
export interface HistoryCoverage {
  /** Signatures actually read across the jar's addresses. Zero means the RPC held nothing. */
  scanned: number;
  /** True when the scan stopped at its cap with an address still unread. */
  hitCap: boolean;
  /** True when the scan stopped at the payment limit with candidates left unfetched. */
  stoppedAtLimit: boolean;
  /** True when the oldest signature read lies at the edge of what the node retains. */
  reachedRetentionFloor: boolean;
}

/**
 * True when an absence of matching payments is evidence, rather than the edge of what was read.
 *
 * Three ways a read can fall short and one of them is not about this app at all. The scan can stop
 * at its cap or at its payment limit, which the jar controls. It can also consume every signature
 * the node will return and still have seen only the last ten days, because that is all a public
 * Cookie Chain node keeps: a jar older than the window ends its history at the node's earliest
 * block, not at its own first payment, and an invoice settled before that reads exactly like one
 * never paid.
 */
export function coversAbsence(coverage: HistoryCoverage | null): boolean {
  if (!coverage) return false;
  return (
    coverage.scanned > 0 &&
    !coverage.hitCap &&
    !coverage.stoppedAtLimit &&
    !coverage.reachedRetentionFloor
  );
}

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
 *
 * `coverage` says how much of the jar's history the read actually saw. Without it, or with a read
 * that stopped early, nothing found means nothing *readable* — `unknown`, not `unpaid`.
 */
export function settlementOf(
  payments: JarPayment[],
  ref: string,
  mint: string,
  requestedRaw: bigint,
  coverage: HistoryCoverage | null = null,
): Settlement {
  const matching = paymentsForRef(payments, ref);
  const paidRaw = matching
    .filter((p) => p.mint === mint)
    .reduce((sum, p) => sum + p.rawAmount, 0n);
  // An open request names no amount, so anything that arrived under its reference settles it.
  let state: SettlementState;
  if (paidRaw > 0n && paidRaw >= requestedRaw) state = "paid";
  else if (paidRaw > 0n) state = "partial";
  // Rows carrying the reference in another token leave the requested amount genuinely at zero, so
  // they read as unpaid in that token — but only when the read saw enough to say so.
  else state = coversAbsence(coverage) ? "unpaid" : "unknown";
  return { state, payments: matching, paidRaw, requestedRaw, totals: totalsByToken(matching) };
}

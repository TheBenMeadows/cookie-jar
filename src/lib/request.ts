import { PublicKey } from "@solana/web3.js";

import { COOK_DECIMALS, COOK_MINT, COOK_SYMBOL } from "./config";
import { decodeBase64Url, encodeBase64Url } from "./base64url";
import { uiToRaw } from "./format";
import { looksLikeName, nameError, normalizeName } from "./names";

/**
 * A payment request. Everything a payer needs travels inside the link, so Cookie Tab stores nothing
 * and a link keeps working whether or not this app is still hosted anywhere.
 *
 * `amount` and `usd` are alternatives: `amount` fixes the token amount, `usd` fixes the dollar value
 * and the token amount is computed against the Cookiescan price when the payer opens the link.
 * Neither one means "the payer names their own amount", which is what a tip jar wants.
 */
export interface PaymentRequest {
  /** Recipient: a base58 address or a `.cook` name. Names resolve at pay time, never at link time. */
  to: string;
  /** Who is being paid, in their own words. Shown above the amount. */
  label?: string;
  /** What the payment is for. Goes on chain in the memo, so it is public. */
  note?: string;
  /** Fixed token amount, as a decimal string in display units. */
  amount?: string;
  /** Token mint. Absent means native COOK. */
  mint?: string;
  /** Decimals of `mint`. Carried in the link so the Pay page can price a token before any RPC call. */
  decimals?: number;
  /** Ticker for display only. Never trusted for arithmetic. */
  symbol?: string;
  /** Fixed dollar amount, as a decimal string. Converted to COOK at pay time. */
  usd?: string;
  /** Caller's own reference — an invoice number, an order id. Echoed in the memo. */
  ref?: string;
}

const WIRE_VERSION = 1;

/** Field caps. A link has to survive being a QR code on a phone screen, and a memo has a size limit. */
export const MAX_LABEL_LENGTH = 60;
export const MAX_NOTE_LENGTH = 180;
export const MAX_REF_LENGTH = 40;
export const MAX_SYMBOL_LENGTH = 12;

/** Every Cookie Tab payment memo starts with this, which is what makes a jar readable from chain. */
export const MEMO_PREFIX = "cookiejar:1";

export class RequestError extends Error {}

interface WireRequest {
  v: number;
  to: string;
  l?: string;
  n?: string;
  a?: string;
  m?: string;
  d?: number;
  s?: string;
  u?: string;
  r?: string;
}

/**
 * Strips Unicode format characters (category Cf) before trimming and checking length.
 * A right-to-left override in a label can reverse how the words beside an amount read.
 */
function trimmedOrUndefined(value: string | undefined, cap: number, field: string): string | undefined {
  if (value === undefined) return undefined;
  const s = value.replace(/\p{Cf}/gu, "").trim();
  if (s === "") return undefined;
  if (s.length > cap) throw new RequestError(`${field} is longer than ${cap} characters`);
  return s;
}

/** The recipient a request names, as a validated string. Resolution to an address happens later. */
export function validateRecipient(to: string): string {
  const s = to.trim();
  if (s === "") throw new RequestError("a payment request needs a recipient");
  if (looksLikeName(s)) {
    const label = normalizeName(s);
    const err = nameError(label);
    if (err) throw new RequestError(`"${to}" is not a valid .cook name — ${err}`);
    return `${label}.cook`;
  }
  try {
    return new PublicKey(s).toBase58();
  } catch {
    throw new RequestError(`"${to}" is neither a Cookie Chain address nor a .cook name`);
  }
}

export function tokenDecimals(request: PaymentRequest): number {
  if (!request.mint || request.mint === COOK_MINT) return COOK_DECIMALS;
  if (request.decimals === undefined) {
    throw new RequestError("a request for a non-COOK token must carry that token's decimals");
  }
  return request.decimals;
}

export function tokenSymbol(request: PaymentRequest): string {
  if (!request.mint || request.mint === COOK_MINT) return COOK_SYMBOL;
  return request.symbol ?? "tokens";
}

/** True when the payer chooses the amount — an open tip jar rather than an invoice. */
export function isOpenAmount(request: PaymentRequest): boolean {
  return request.amount === undefined && request.usd === undefined;
}

export function normalizeRequest(input: PaymentRequest): PaymentRequest {
  const to = validateRecipient(input.to);
  const label = trimmedOrUndefined(input.label, MAX_LABEL_LENGTH, "the label");
  const note = trimmedOrUndefined(input.note, MAX_NOTE_LENGTH, "the note");
  const ref = trimmedOrUndefined(input.ref, MAX_REF_LENGTH, "the reference");
  const symbol = trimmedOrUndefined(input.symbol, MAX_SYMBOL_LENGTH, "the symbol");

  if (input.amount !== undefined && input.usd !== undefined) {
    throw new RequestError("a request fixes either a token amount or a dollar amount, not both");
  }

  let mint: string | undefined;
  if (input.mint !== undefined && input.mint.trim() !== "" && input.mint !== COOK_MINT) {
    try {
      mint = new PublicKey(input.mint.trim()).toBase58();
    } catch {
      throw new RequestError(`"${input.mint}" is not a token mint address`);
    }
  }

  let decimals: number | undefined;
  if (mint) {
    if (
      input.decimals === undefined ||
      !Number.isInteger(input.decimals) ||
      input.decimals < 0 ||
      input.decimals > 18
    ) {
      throw new RequestError("a non-COOK token needs its decimals, as a whole number from 0 to 18");
    }
    decimals = input.decimals;
  }

  const normalized: PaymentRequest = { to };
  if (label) normalized.label = label;
  if (note) normalized.note = note;
  if (ref) normalized.ref = ref;
  if (mint) normalized.mint = mint;
  if (decimals !== undefined) normalized.decimals = decimals;
  if (mint && symbol) normalized.symbol = symbol;

  if (input.amount !== undefined && input.amount.trim() !== "") {
    const amount = input.amount.trim();
    const raw = uiToRaw(amount, decimals ?? COOK_DECIMALS);
    if (raw <= 0n) throw new RequestError("the amount has to be greater than zero");
    normalized.amount = amount;
  }

  if (input.usd !== undefined && input.usd.trim() !== "") {
    const usd = input.usd.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(usd) || Number(usd) <= 0) {
      throw new RequestError("the dollar amount has to be a positive number with at most 2 decimals");
    }
    normalized.usd = usd;
  }

  return normalized;
}

export function encodeRequest(request: PaymentRequest): string {
  const r = normalizeRequest(request);
  const wire: WireRequest = { v: WIRE_VERSION, to: r.to };
  if (r.label) wire.l = r.label;
  if (r.note) wire.n = r.note;
  if (r.amount) wire.a = r.amount;
  if (r.mint) wire.m = r.mint;
  if (r.decimals !== undefined) wire.d = r.decimals;
  if (r.symbol) wire.s = r.symbol;
  if (r.usd) wire.u = r.usd;
  if (r.ref) wire.r = r.ref;
  return encodeBase64Url(JSON.stringify(wire));
}

export function decodeRequest(encoded: string): PaymentRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(encoded.trim()));
  } catch {
    throw new RequestError("this payment link is damaged — the code after #/pay/ did not decode");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RequestError("this payment link does not contain a payment request");
  }
  const wire = parsed as Partial<WireRequest>;
  if (wire.v !== WIRE_VERSION) {
    throw new RequestError(
      `this link was made by a newer version of Cookie Tab (format ${String(wire.v)})`,
    );
  }
  if (typeof wire.to !== "string") throw new RequestError("this payment link names no recipient");

  const str = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

  return normalizeRequest({
    to: wire.to,
    label: str(wire.l),
    note: str(wire.n),
    amount: str(wire.a),
    mint: str(wire.m),
    decimals: typeof wire.d === "number" ? wire.d : undefined,
    symbol: str(wire.s),
    usd: str(wire.u),
    ref: str(wire.r),
  });
}

export function payUrl(request: PaymentRequest, origin: string): string {
  return `${origin.replace(/\/$/, "")}/#/pay/${encodeRequest(request)}`;
}

export function jarUrl(recipient: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/#/jar/${encodeURIComponent(recipient)}`;
}

/**
 * The jar narrowed to one reference: a page anyone can open to see whether an invoice was paid,
 * rebuilt from chain data alone. Given to the payer after paying and to the recipient on the jar.
 */
export function receiptUrl(recipient: string, ref: string, origin: string): string {
  return `${jarUrl(recipient, origin)}?ref=${encodeURIComponent(ref)}`;
}

// --- Memos ----------------------------------------------------------------------------------------

/**
 * `cookiejar:1|<ref>|<note>`. The reference sits in a fixed field so an invoice number survives a
 * note that itself contains a `|`, and the note takes everything after it.
 */
export function buildMemo(request: PaymentRequest): string {
  const ref = (request.ref ?? "").replace(/\|/g, "/");
  const note = (request.note ?? "").replace(/\r?\n/g, " ");
  return `${MEMO_PREFIX}|${ref}|${note}`.slice(0, MEMO_PREFIX.length + 2 + MAX_REF_LENGTH + MAX_NOTE_LENGTH);
}

export interface ParsedMemo {
  ref: string | null;
  note: string | null;
}

/** null when the memo was not written by Cookie Tab, which is how a jar filters other transfers. */
export function parseMemo(memo: string): ParsedMemo | null {
  if (!memo.startsWith(`${MEMO_PREFIX}|`)) return null;
  const rest = memo.slice(MEMO_PREFIX.length + 1);
  const cut = rest.indexOf("|");
  if (cut < 0) return { ref: rest || null, note: null };
  return {
    ref: rest.slice(0, cut) || null,
    note: rest.slice(cut + 1) || null,
  };
}

/**
 * Amount conversion between the decimal strings a person types and the integer base units a
 * transaction carries. All of it is string/BigInt arithmetic — a COOK amount that fits a payment
 * link ("1,500,000 COOK") already exceeds what a double can hold in base units at 9 decimals.
 */

export function uiToRaw(ui: string, decimals: number): bigint {
  const cleaned = ui.trim().replace(/,/g, "").replace(/_/g, "");
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === ".") {
    throw new Error(`"${ui}" is not a number`);
  }
  const [whole = "", fraction = ""] = cleaned.split(".");
  if (fraction.length > decimals) {
    throw new Error(`too many decimal places — this token holds ${decimals}`);
  }
  const padded = fraction.padEnd(decimals, "0");
  return BigInt(`${whole || "0"}${padded}`);
}

export function rawToUi(raw: bigint | string, decimals: number): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * An amount as a person reads it, grouped and cut to a sane number of decimal places. A dollar-quoted
 * request divides out to every one of a token's decimals — $25.00 of COOK is 273,827.349709201 — and
 * nine of them in a headline is noise a payer cannot act on.
 *
 * Display only. `rawToUi` stays the exact figure, and the transaction always carries `raw` itself.
 */
export function displayAmount(raw: bigint | string, decimals: number): string {
  const exact = rawToUi(raw, decimals);
  const value = Number(exact);
  if (!Number.isFinite(value)) return groupDigits(exact);
  // `toFixed` switches to exponent notation from 1e21 up, and "1e+21 COOK" is not an amount anyone
  // can check against a wallet prompt.
  if (Math.abs(value) >= 1e21) return groupDigits(exact);

  const magnitude = Math.abs(value);
  let places: number;
  if (magnitude >= 1000) places = 0;
  else if (magnitude >= 1) places = 4;
  else places = Math.min(decimals, 8);

  // Trailing zeros are only ever droppable after a decimal point. Stripping them from a whole
  // number turns 25,000 into 25.
  let text = value.toFixed(places);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return groupDigits(text);
}

/** True when `displayAmount` had to round, so the exact figure is worth showing alongside it. */
export function isRounded(raw: bigint | string, decimals: number): boolean {
  return displayAmount(raw, decimals) !== groupDigits(rawToUi(raw, decimals));
}

/** Group the integer part with thin separators for display. Never used to build a transaction. */
export function groupDigits(value: string): string {
  const [whole = "", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toPrecision(2)}`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `7rQTSW…zEzR` — enough of an address to recognise, short enough to sit in a table row. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function formatTimestamp(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

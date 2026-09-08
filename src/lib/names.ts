import { COOK_TLD } from "./config";

/**
 * `.cook` name rules. Pure string work — the same rules the CookOven registry enforces on chain, so
 * a bad name is refused before it costs a round trip. The suffix is presentation only: the PDA seed
 * and the registry's `name` field both hold the bare label ("baker", not "baker.cook").
 */

/** A PDA seed is capped at 32 bytes, which caps the label. */
export const MAX_NAME_LENGTH = 32;

export function normalizeName(input: string): string {
  const s = input.trim().toLowerCase();
  return s.endsWith(COOK_TLD) ? s.slice(0, -COOK_TLD.length) : s;
}

export function displayName(label: string): string {
  return `${label}${COOK_TLD}`;
}

export function nameError(label: string): string | null {
  if (label.length === 0) return "the name is empty";
  if (new TextEncoder().encode(label).length > MAX_NAME_LENGTH) {
    return `the name is longer than ${MAX_NAME_LENGTH} characters`;
  }
  if (!/^[a-z0-9-]+$/.test(label)) return "only a-z, 0-9 and hyphens are allowed";
  if (label.startsWith("-") || label.endsWith("-")) return "no leading or trailing hyphen";
  return null;
}

export function isValidName(label: string): boolean {
  return nameError(label) === null;
}

/**
 * Should this be read as a name rather than an address? An explicit `.cook` always is; otherwise
 * anything that is not a well-formed base58 pubkey is. The two can never collide — a 32-character
 * `[a-z0-9-]` label decodes to about 23 bytes, well short of a 32-byte key.
 */
export function looksLikeName(input: string): boolean {
  const s = input.trim();
  if (s.toLowerCase().endsWith(COOK_TLD)) return true;
  return !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

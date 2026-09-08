/**
 * base64url over UTF-8, without the `=` padding. Isomorphic on purpose: the encode side runs in the
 * browser when a link is created and the decode side runs in Node when the live-check script
 * round-trips a link, so neither may depend on `Buffer` or on `btoa` alone.
 */

const CHUNK = 0x8000;

function bytesToBinary(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  const g = globalThis as { btoa?: (s: string) => string };
  if (typeof g.btoa === "function") return g.btoa(bytesToBinary(bytes));
  return Buffer.from(bytes).toString("base64");
}

function base64Decode(b64: string): Uint8Array {
  const g = globalThis as { atob?: (s: string) => string };
  if (typeof g.atob === "function") {
    const binary = g.atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return new TextDecoder().decode(base64Decode(padded));
}

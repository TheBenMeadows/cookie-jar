import { PublicKey } from "@solana/web3.js";

import { envUrl } from "./env";

/** Cookie Chain JSON-RPC. Solana's `solana-core` 4.1.2 runs the chain, so web3.js works unchanged. */
export const RPC_URL = envUrl("VITE_COOKIE_RPC_URL", "https://rpc.cookiescan.io");
export const WS_URL = envUrl("VITE_COOKIE_WS_URL", "wss://wss.cookiescan.io");

/** Cookiescan REST: token registry, prices, markets. Also serves the DAS JSON-RPC on the same host. */
export const COOKIESCAN_API = envUrl("VITE_COOKIESCAN_API_URL", "https://api.cookiescan.io");

/** Cookiebox aggregator — the router behind cookiebox.app, exposed as `GET /quote` + `POST /swap-tx`. */
export const COOKIEBOX_AGG_API = envUrl("VITE_COOKIEBOX_AGG_URL", "https://agg.cookiebox.app");

/** Candy Shop aggregator — the fallback router, same job over a different route set. */
export const CANDYSHOP_API = envUrl("VITE_CANDYSHOP_API_URL", "https://swap.cookiescan.io/api");

export const EXPLORER_URL = envUrl("VITE_COOKIE_EXPLORER_URL", "https://cookiescan.io");

/** Where the source lives. Set `VITE_REPO_URL` at build time once the repository exists. */
export const REPO_URL = envUrl("VITE_REPO_URL", "https://github.com/TheBenMeadows/cookie-tab");

/**
 * Where a payer without COOK goes to get some: the Hyperlane warp route between Solana mainnet and
 * Cookie Chain. This is the address the cookiechain.wtf ecosystem page links as "Bridge"; it
 * redirects to hyperlane.cookiescan.io.
 */
export const BRIDGE_URL = "https://bridge.cookiescan.io";

/**
 * COOK is the native gas token. Its wrapped mint is the same string Solana uses for wSOL — on this
 * chain that address is wCOOK, so nothing may infer a token's identity from the mint alone.
 */
export const COOK_MINT = "So11111111111111111111111111111111111111112";
export const COOK_DECIMALS = 9;
export const COOK_SYMBOL = "COOK";

/** Fee charged per signature, in COOK. One signature per payment, so this is the whole cost. */
export const FEE_PER_SIGNATURE_COOK = 0.000005;

/**
 * The Cookie Jar: Cookie Chain's community treasury, vault 1 of the community multisig
 * (https://docs.cookiechain.wtf/cookie-jar). A plain system-owned wallet, so it can be paid like
 * any other recipient. A payer can add a share of any payment to it, in the same transaction.
 */
export const COOKIE_JAR_TREASURY = "568tU9FMksJDxjkLBjWisSA4J4C5uPH87NCCkyREwrxe";

/** The share a payer adds for the Cookie Jar when they opt in, in basis points. */
export const ROUND_UP_BPS = 100;

/** SPL Memo v2. Every Cookie Tab payment carries one, which is what makes a jar readable from chain. */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** CookOven `.cook` name registry. A single deployment; the dApp is client-side, so there is no API. */
export const COOKIE_DOMAINS_PROGRAM_ID = new PublicKey(
  "H43Qtq4AMQ86y7yc3YtCKZJ2QMhhnCcHyZKeFeoQn7PA",
);

/** The `.cook` secondary market. A listed name is owned by this program's escrow, not by its seller. */
export const COOKIE_DOMAINS_MARKET_PROGRAM_ID = new PublicKey(
  "Ey35mr69UfiQqZSwD2qYAZoMNfnuVJGCjwNSB64ppHm7",
);

export const COOK_TLD = ".cook";

export const HTTP_TIMEOUT_MS = 15_000;

/** Default slippage for the optional swap step, in basis points. */
export const DEFAULT_SLIPPAGE_BPS = 500;

export function explorerTxUrl(signature: string): string {
  return `${EXPLORER_URL}/tx/${signature}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}

export function explorerTokenUrl(mint: string): string {
  return `${EXPLORER_URL}/token/${mint}`;
}

import { Connection } from "@solana/web3.js";

import { RPC_URL, WS_URL } from "./config";

let shared: Connection | null = null;

/** One connection for the whole app. Cookie Chain's public RPC is shared, so the app is thrifty with it. */
export function getConnection(): Connection {
  if (!shared) {
    shared = new Connection(RPC_URL, { commitment: "confirmed", wsEndpoint: WS_URL });
  }
  return shared;
}

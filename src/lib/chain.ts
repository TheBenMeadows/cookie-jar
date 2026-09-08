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

/**
 * Wait for a signature by polling its status. The aggregators return a transaction carrying their
 * own blockhash and do not always say which, so there is no blockhash to expire against — a poll
 * with a deadline is what is left.
 */
export async function waitForSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new Error(`the transaction failed on chain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("the transaction was sent but had not confirmed after a minute — check the explorer");
}

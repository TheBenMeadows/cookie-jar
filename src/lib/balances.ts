import { PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { COOK_DECIMALS, COOK_MINT, COOK_SYMBOL } from "./config";

/**
 * What a payer actually holds. Both SPL token programs are queried, because Cookie Chain carries
 * mints under Token and under Token-2022 and a wallet does not know or care which one a merchant
 * asked for.
 */

export interface Holding {
  mint: string;
  raw: bigint;
  decimals: number;
  symbol: string | null;
}

export async function fetchNativeBalance(
  connection: Connection,
  owner: PublicKey,
): Promise<Holding> {
  const lamports = await connection.getBalance(owner);
  return { mint: COOK_MINT, raw: BigInt(lamports), decimals: COOK_DECIMALS, symbol: COOK_SYMBOL };
}

/** Every SPL balance the wallet holds, largest first. Empty accounts are dropped. */
export async function fetchTokenHoldings(
  connection: Connection,
  owner: PublicKey,
): Promise<Holding[]> {
  const responses = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getParsedTokenAccountsByOwner(owner, { programId }),
    ),
  );

  const totals = new Map<string, Holding>();
  for (const response of responses) {
    for (const { account } of response.value) {
      const info = account.data.parsed?.info;
      const mint: unknown = info?.mint;
      const amount: unknown = info?.tokenAmount?.amount;
      const decimals: unknown = info?.tokenAmount?.decimals;
      if (typeof mint !== "string" || typeof amount !== "string" || typeof decimals !== "number") {
        continue;
      }
      const raw = BigInt(amount);
      if (raw === 0n) continue;
      const existing = totals.get(mint);
      if (existing) existing.raw += raw;
      else totals.set(mint, { mint, raw, decimals, symbol: null });
    }
  }

  return [...totals.values()].sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0));
}

/** The payer's balance in one specific token, native COOK included. */
export async function fetchBalanceOf(
  connection: Connection,
  owner: PublicKey,
  mint: string | undefined,
): Promise<Holding> {
  if (!mint || mint === COOK_MINT) return fetchNativeBalance(connection, owner);
  const key = new PublicKey(mint);
  const responses = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getParsedTokenAccountsByOwner(owner, { mint: key, programId }).catch(() => null),
    ),
  );
  let raw = 0n;
  let decimals = 0;
  for (const response of responses) {
    for (const { account } of response?.value ?? []) {
      const amount: unknown = account.data.parsed?.info?.tokenAmount?.amount;
      const d: unknown = account.data.parsed?.info?.tokenAmount?.decimals;
      if (typeof amount === "string") raw += BigInt(amount);
      if (typeof d === "number") decimals = d;
    }
  }
  return { mint, raw, decimals, symbol: null };
}

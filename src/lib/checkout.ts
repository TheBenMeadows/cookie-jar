import { Buffer } from "buffer";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

/**
 * One transaction for a payer who holds the wrong token: the router's swap and the payment, signed
 * once, landing together or not at all. The swap transaction arrives from the aggregator already
 * built and checked (`verifySwapTransaction`); this takes it apart, appends the payment's own
 * instructions — transfer, token-account create, memo — and puts it back together as one v0 message
 * paid for by the same wallet.
 *
 * A transaction has a hard size limit, and a two-hop route with the payment behind it can pass it.
 * That is reported rather than worked around: the two-step checkout is always there, and a payer
 * is told which of the two they are signing.
 */

/** The largest transaction a Solana-family node accepts, in serialized bytes. */
export const MAX_TRANSACTION_BYTES = 1232;

export type Composed =
  | { ok: true; transaction: VersionedTransaction; bytes: number }
  /** `bytes` is null when the message would not even serialize, which is further past the limit. */
  | { ok: false; reason: "too-big"; bytes: number | null };

/** The lookup tables a versioned transaction references, read from the chain. */
export async function lookupTablesOf(
  connection: Connection,
  transaction: VersionedTransaction,
): Promise<AddressLookupTableAccount[]> {
  const tables: AddressLookupTableAccount[] = [];
  for (const lookup of transaction.message.addressTableLookups) {
    const result = await connection.getAddressLookupTable(lookup.accountKey);
    if (!result.value) {
      throw new Error(`the router's transaction uses lookup table ${lookup.accountKey.toBase58()}, which this RPC cannot find`);
    }
    tables.push(result.value);
  }
  return tables;
}

export function composeSwapAndPayment(args: {
  swap: VersionedTransaction;
  lookupTables: AddressLookupTableAccount[];
  payment: TransactionInstruction[];
  payer: PublicKey;
  blockhash: string;
}): Composed {
  const { swap, lookupTables, payment, payer, blockhash } = args;
  const message = TransactionMessage.decompile(swap.message, {
    addressLookupTableAccounts: lookupTables,
  });
  message.instructions.push(...payment);
  message.payerKey = payer;
  message.recentBlockhash = blockhash;
  const transaction = new VersionedTransaction(message.compileToV0Message(lookupTables));
  let bytes: number;
  try {
    bytes = transaction.serialize().length;
  } catch {
    // Serialization writes into a fixed packet-sized buffer and throws past its end.
    return { ok: false, reason: "too-big", bytes: null };
  }
  if (bytes > MAX_TRANSACTION_BYTES) return { ok: false, reason: "too-big", bytes };
  return { ok: true, transaction, bytes };
}

export interface CheckoutVerification {
  ok: boolean;
  reason: string | null;
}

/** Base units sit at offset 64 of an SPL token account, in Token and in Token-2022 alike. */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;

function tokenAmount(data: string): bigint | null {
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  if (bytes.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
    TOKEN_ACCOUNT_AMOUNT_OFFSET,
    true,
  );
}

/**
 * The composed transaction, simulated as a whole, has to leave the recipient exactly the payment
 * richer. The swap half was checked on its own before this; what is new is the two halves running
 * together, so the one thing left to prove is that the payment arrives out of the swap's output.
 * `destination` is the recipient's wallet for native COOK, or their token account otherwise.
 */
export async function verifyComposedCheckout(args: {
  connection: Connection;
  transaction: VersionedTransaction;
  destination: PublicKey;
  native: boolean;
  rawAmount: bigint;
}): Promise<CheckoutVerification> {
  const { connection, transaction, destination, native, rawAmount } = args;

  let before: bigint;
  if (native) {
    before = BigInt(await connection.getBalance(destination));
  } else {
    const info = await connection.getAccountInfo(destination);
    before = info ? (tokenAmount(Buffer.from(info.data).toString("base64")) ?? 0n) : 0n;
  }

  const simulation = await connection.simulateTransaction(transaction, {
    replaceRecentBlockhash: true,
    sigVerify: false,
    accounts: { encoding: "base64", addresses: [destination.toBase58()] },
  });
  if (simulation.value.err) {
    return {
      ok: false,
      reason: `swap and payment did not simulate together: ${simulation.value.logs?.slice(-2).join(" | ") ?? JSON.stringify(simulation.value.err)}`,
    };
  }
  const account = simulation.value.accounts?.[0];
  if (!account) return { ok: false, reason: "the simulation did not report the recipient's account" };
  let after: bigint | null;
  if (native) {
    after = BigInt(account.lamports);
  } else {
    const raw = Array.isArray(account.data) ? account.data[0] : null;
    after = typeof raw === "string" ? tokenAmount(raw) : null;
  }
  if (after === null) return { ok: false, reason: "the simulation did not report the recipient's balance" };
  const delta = after - before;
  if (delta !== rawAmount) {
    return {
      ok: false,
      reason: `the recipient would receive ${delta} base units rather than the ${rawAmount} requested`,
    };
  }
  return { ok: true, reason: null };
}

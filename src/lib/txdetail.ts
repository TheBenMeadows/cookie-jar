import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, type Connection, type ParsedTransactionWithMeta, SystemProgram } from "@solana/web3.js";

import { MEMO_PROGRAM_ID } from "./config";

/** Details extracted from a landed transaction to display on a receipt. */
export interface TxDetail {
  /** Signatures on the transaction. One means the payer signed once for everything in it. */
  signatures: number;
  /** Top-level instructions in the message. */
  instructions: number;
  /** Instructions the programs above issued in turn, across every inner group. */
  innerInstructions: number;
  /**
   * Program ids invoked at the top level that are not housekeeping (system, compute budget, the two
   * token programs, the associated-token program, the memo program), in order of first appearance.
   * For a composed checkout these are the swap venues.
   */
  venues: string[];
  /** True when a memo-program instruction is present at the top level. */
  hasMemo: boolean;
}

/** Programs every payment touches on its way through, which say nothing about what the payment was. */
export const HOUSEKEEPING_PROGRAMS: ReadonlySet<string> = new Set([
  SystemProgram.programId.toBase58(),
  ComputeBudgetProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  MEMO_PROGRAM_ID.toBase58(),
]);

/** Pure summary of a parsed transaction, so it can be tested without a connection. */
export function summarizeTransaction(tx: ParsedTransactionWithMeta): TxDetail {
  const signatures = tx.transaction.signatures.length;
  const topInstructions = tx.transaction.message.instructions;
  const instructions = topInstructions.length;

  let innerInstructions = 0;
  if (tx.meta?.innerInstructions) {
    for (const group of tx.meta.innerInstructions) {
      innerInstructions += group.instructions.length;
    }
  }

  const memoProgramId = MEMO_PROGRAM_ID.toBase58();
  let hasMemo = false;
  const venues: string[] = [];

  for (const ix of topInstructions) {
    const programIdStr = ix.programId.toBase58();
    if (programIdStr === memoProgramId) {
      hasMemo = true;
    }
    if (!HOUSEKEEPING_PROGRAMS.has(programIdStr)) {
      if (!venues.includes(programIdStr)) {
        venues.push(programIdStr);
      }
    }
  }

  return {
    signatures,
    instructions,
    innerInstructions,
    venues,
    hasMemo,
  };
}

/**
 * Fetch and summarise one signature. Null when the RPC no longer holds the transaction: a public
 * Cookie Chain node keeps roughly ten days, and a receipt older than that is settled on chain and
 * simply cannot be described from here.
 */
export async function fetchTxDetail(
  connection: Connection,
  signature: string,
): Promise<TxDetail | null> {
  const parsed = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });
  if (!parsed) return null;
  return summarizeTransaction(parsed);
}

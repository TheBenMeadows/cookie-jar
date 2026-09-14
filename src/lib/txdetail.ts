import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Connection,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
  SystemProgram,
} from "@solana/web3.js";

import { MEMO_PROGRAM_ID } from "./config";

/** The shape of a landed transaction, for a receipt that says more than "paid". */
export interface TxDetail {
  /** Signatures on the transaction. One means the payer signed once for everything in it. */
  signatures: number;
  /** Top-level instructions in the message, housekeeping included. */
  instructions: number;
  /** Instructions the programs above issued in turn, across every inner group. */
  innerInstructions: number;
  /**
   * Program ids invoked anywhere in the transaction, top level or inner, that are not housekeeping
   * (system, compute budget, the two token programs, the associated-token program, the memo
   * program), in order of first appearance. On a composed checkout these are the programs the swap
   * went through; a router that calls venues through CPI lists both itself and the venues. Nothing
   * here says which of them is a venue, so a receipt names them as programs and links each one.
   */
  programs: string[];
  /** True when a memo-program instruction is present anywhere, which is how the jar reads memos too. */
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
  const top = tx.transaction.message.instructions;
  const inner: (ParsedInstruction | PartiallyDecodedInstruction)[] = (
    tx.meta?.innerInstructions ?? []
  ).flatMap((group) => group.instructions);

  const memoProgramId = MEMO_PROGRAM_ID.toBase58();
  let hasMemo = false;
  const programs: string[] = [];
  for (const ix of [...top, ...inner]) {
    const programId = ix.programId.toBase58();
    if (programId === memoProgramId) hasMemo = true;
    if (!HOUSEKEEPING_PROGRAMS.has(programId) && !programs.includes(programId)) {
      programs.push(programId);
    }
  }

  return {
    signatures: tx.transaction.signatures.length,
    instructions: top.length,
    innerInstructions: inner.length,
    programs,
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

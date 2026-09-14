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

/** One top-level instruction, as a reader can check it against the explorer. */
export interface TxStep {
  /** Position in the message, counting from one, which is how the explorer lists them. */
  position: number;
  /** The program's own id, always shown, because it is the part anyone can verify. */
  programId: string;
  /**
   * What the RPC's parser called it: `spl-token transferChecked`, `spl-memo`. Null for a program
   * the parser does not know, which on a composed checkout is the swap program itself.
   */
  parsed: string | null;
  /**
   * What it does, in a sentence, for the instructions a payment is built from. Null where this app
   * has nothing to add beyond the parse, rather than a guess dressed as a description.
   */
  sentence: string | null;
}

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
  /** The top-level instructions in order, so a reader can step through what one signature authorised. */
  steps: TxStep[];
}

/**
 * Plain descriptions for the instructions a Cookie Tab payment is built from, keyed by the parser's
 * own `program` and `type`. Anything absent from this table renders as its parse and its program id
 * and nothing more: a sentence this app cannot stand behind is worse than no sentence, and the id
 * is the part a reader can check.
 */
const SENTENCES: Record<string, string> = {
  "spl-associated-token-account:createIdempotent":
    "Opens the recipient's account for this token, if they do not have one already",
  "system:createAccountWithSeed": "Opens a temporary account to hold wrapped COOK for the swap",
  "spl-token:initializeAccount3": "Prepares that temporary account",
  "spl-token:closeAccount": "Closes the temporary account and returns its rent",
  "spl-token:transfer": "Moves the swapped token",
  "spl-token:transferChecked": "Pays the recipient, against the mint and decimals the request named",
  "system:transfer": "Pays the recipient in native COOK",
  "spl-memo:": "Writes the invoice reference on chain, which is what puts the payment in a jar",
};

/** The compute-budget program is unparsed by the RPC but is not a mystery. */
const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();

function describe(programId: string, program: string | null, type: string | null): string | null {
  if (programId === COMPUTE_BUDGET) return "Sets what the transaction may spend on computation";
  if (!program) return null;
  return SENTENCES[`${program}:${type ?? ""}`] ?? null;
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

  const steps: TxStep[] = top.map((ix, i) => {
    const programId = ix.programId.toBase58();
    const program = "program" in ix && typeof ix.program === "string" ? ix.program : null;
    const type =
      "parsed" in ix && typeof ix.parsed === "object" && ix.parsed !== null
        ? ((ix.parsed as { type?: unknown }).type ?? null)
        : null;
    const typeName = typeof type === "string" ? type : null;
    return {
      position: i + 1,
      programId,
      parsed: program ? [program, typeName].filter(Boolean).join(" ") : null,
      sentence: describe(programId, program, typeName),
    };
  });

  return {
    signatures: tx.transaction.signatures.length,
    instructions: top.length,
    innerInstructions: inner.length,
    programs,
    hasMemo,
    steps,
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

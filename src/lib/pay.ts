import { Buffer } from "buffer";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { COOK_MINT, MEMO_PROGRAM_ID } from "./config";

/**
 * Building the payment. Two shapes, one memo: a native COOK payment is a system transfer, a token
 * payment is a checked SPL transfer with an idempotent create for the recipient's token account.
 * The memo instruction is what turns a transfer into a Cookie Jar receipt — it is the only reason a
 * jar's history can be rebuilt from chain data with no server involved.
 */

export class PaymentError extends Error {}

export function memoInstruction(memo: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(new TextEncoder().encode(memo)),
  });
}

export interface BuildPaymentArgs {
  connection: Connection;
  payer: PublicKey;
  recipient: PublicKey;
  /** Amount in base units. */
  rawAmount: bigint;
  /** Absent, or the COOK mint, means a native transfer. */
  mint?: string;
  decimals: number;
  memo: string;
  /**
   * A payment competes with nothing on Cookie Chain, so the fee stays at the 5,000-lamport base
   * unless a caller asks otherwise. Priced in micro-lamports per compute unit.
   */
  priorityFeeMicroLamports?: number;
}

export interface BuiltPayment {
  transaction: Transaction;
  /** True when the transaction creates the recipient's token account, which the payer pays rent for. */
  createsRecipientAccount: boolean;
  /** The SPL token program that owns the mint, or null for a native COOK payment. */
  tokenProgramId: PublicKey | null;
  /** Carried out so the caller can confirm against the same blockhash the transaction was built on. */
  blockhash: string;
  lastValidBlockHeight: number;
}

/** Which token program owns this mint — Token or Token-2022. Both exist on Cookie Chain. */
export async function fetchTokenProgramId(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new PaymentError(`no token exists at ${mint.toBase58()} on Cookie Chain`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new PaymentError(`${mint.toBase58()} is not an SPL token mint`);
}

export async function buildPayment(args: BuildPaymentArgs): Promise<BuiltPayment> {
  const { connection, payer, recipient, rawAmount, memo, decimals } = args;
  if (rawAmount <= 0n) throw new PaymentError("the amount has to be greater than zero");
  if (recipient.equals(payer)) throw new PaymentError("this jar belongs to the connected wallet");

  const transaction = new Transaction();
  if (args.priorityFeeMicroLamports && args.priorityFeeMicroLamports > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: args.priorityFeeMicroLamports,
      }),
    );
  }

  const isNative = !args.mint || args.mint === COOK_MINT;
  let createsRecipientAccount = false;
  let tokenProgramId: PublicKey | null = null;

  if (isNative) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: rawAmount,
      }),
    );
  } else {
    const mint = new PublicKey(args.mint as string);
    tokenProgramId = await fetchTokenProgramId(connection, mint);
    const source = getAssociatedTokenAddressSync(mint, payer, true, tokenProgramId);
    const destination = getAssociatedTokenAddressSync(mint, recipient, true, tokenProgramId);

    const destinationInfo = await connection.getAccountInfo(destination);
    if (!destinationInfo) {
      createsRecipientAccount = true;
      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          destination,
          recipient,
          mint,
          tokenProgramId,
        ),
      );
    }

    transaction.add(
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        payer,
        rawAmount,
        decimals,
        [],
        tokenProgramId,
      ),
    );
  }

  transaction.add(memoInstruction(memo, payer));
  transaction.feePayer = payer;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;

  return {
    transaction,
    createsRecipientAccount,
    tokenProgramId,
    blockhash,
    lastValidBlockHeight,
  };
}

export interface SimulationOutcome {
  ok: boolean;
  /** The raw simulation error, when there was one. */
  err: unknown;
  logs: string[];
  /**
   * True when the only thing wrong is that the payer cannot cover the transfer. Everything else
   * about the transaction — accounts, programs, instruction data — passed.
   */
  insufficientFunds: boolean;
  /**
   * True for the narrower case where the payer address holds nothing at all, so Cookie Chain has no
   * account for it. A wallet that has never received COOK answers `AccountNotFound` rather than
   * "insufficient lamports", and the two want different words in front of a payer.
   */
  unfundedAccount: boolean;
  message: string | null;
}

const UNFUNDED_PATTERN = /AccountNotFound/;

const INSUFFICIENT_PATTERNS = [
  /insufficient lamports/i,
  /insufficient funds/i,
  /Error processing Instruction \d+: custom program error: 0x1\b/,
];

/**
 * Simulate without signing. The interesting case is an unfunded payer: an "insufficient funds"
 * failure means every other part of the transaction is valid, which is exactly what the offline test
 * suite asserts.
 */
export async function simulatePayment(
  connection: Connection,
  transaction: Transaction,
): Promise<SimulationOutcome> {
  const result = await connection.simulateTransaction(transaction);
  const logs = result.value.logs ?? [];
  if (!result.value.err) {
    return {
      ok: true,
      err: null,
      logs,
      insufficientFunds: false,
      unfundedAccount: false,
      message: null,
    };
  }
  const blob = `${JSON.stringify(result.value.err)} ${logs.join(" ")}`;
  const unfundedAccount = UNFUNDED_PATTERN.test(blob);
  const insufficientFunds = unfundedAccount || INSUFFICIENT_PATTERNS.some((p) => p.test(blob));

  let message: string;
  if (unfundedAccount) {
    message = "this wallet holds no COOK on Cookie Chain, so it cannot pay the network fee";
  } else if (insufficientFunds) {
    message = "this wallet does not hold enough to cover the payment and its fee";
  } else {
    message = logs.slice(-2).join(" | ") || JSON.stringify(result.value.err);
  }

  return { ok: false, err: result.value.err, logs, insufficientFunds, unfundedAccount, message };
}

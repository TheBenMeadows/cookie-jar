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
  unpackMint,
} from "@solana/spl-token";

import { COOK_MINT, MEMO_PROGRAM_ID } from "./config";

/**
 * Building the payment. Two shapes, one memo: a native COOK payment is a system transfer, a token
 * payment is a checked SPL transfer with an idempotent create for the recipient's token account.
 * The memo instruction is what turns a transfer into a Cookie Tab receipt — it is the only reason a
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

export interface MintFacts {
  programId: PublicKey;
  decimals: number;
}

/**
 * The mint, read from the chain: which token program owns it, and how many decimals it has.
 *
 * The decimals matter beyond display. A payment link carries them so the Pay page can price a
 * request before any RPC call, but a link is attacker-controlled text: a link claiming 6 decimals
 * for a 9-decimal token turns "1.5" into 1,500 times less than the payer reads. `TransferChecked`
 * would catch it on chain, but only after the payer had signed. This is read first and the two are
 * compared before anything is built.
 */
export async function fetchMintFacts(
  connection: Connection,
  mint: PublicKey,
): Promise<MintFacts> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new PaymentError(`no token exists at ${mint.toBase58()} on Cookie Chain`);
  let programId: PublicKey;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) programId = TOKEN_2022_PROGRAM_ID;
  else if (info.owner.equals(TOKEN_PROGRAM_ID)) programId = TOKEN_PROGRAM_ID;
  else throw new PaymentError(`${mint.toBase58()} is not an SPL token mint`);
  return { programId, decimals: unpackMint(mint, info, programId).decimals };
}

/**
 * Which of the payer's accounts the transfer draws from.
 *
 * A wallet can hold one mint across several accounts, and only the associated one is derivable. A
 * balance summed across all of them would show a payer enough to cover an invoice that the transfer
 * then cannot draw, so the account is chosen here and the amount is checked against that account
 * alone.
 */
export async function chooseSourceAccount(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  programId: PublicKey,
  rawAmount: bigint,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, payer, true, programId);
  const { value } = await connection.getParsedTokenAccountsByOwner(payer, { mint, programId });

  const accounts = value
    .map(({ pubkey, account }) => {
      const amount: unknown = account.data.parsed?.info?.tokenAmount?.amount;
      return { pubkey, raw: typeof amount === "string" ? BigInt(amount) : 0n };
    })
    .sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0));

  const ataHolding = accounts.find((a) => a.pubkey.equals(ata));
  if (ataHolding && ataHolding.raw >= rawAmount) return ata;

  const largest = accounts[0];
  if (largest && largest.raw >= rawAmount) return largest.pubkey;

  const total = accounts.reduce((sum, a) => sum + a.raw, 0n);
  if (accounts.length > 1 && total >= rawAmount) {
    throw new PaymentError(
      `this wallet holds enough of this token, but split across ${accounts.length} accounts and no ` +
        "single one covers the payment — consolidate them first, because one transfer draws from one account",
    );
  }
  throw new PaymentError("this wallet does not hold enough of this token to cover the payment");
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
    const facts = await fetchMintFacts(connection, mint);
    tokenProgramId = facts.programId;
    if (facts.decimals !== decimals) {
      throw new PaymentError(
        `this link says ${mint.toBase58()} has ${decimals} decimals; the chain says ${facts.decimals}. ` +
          "Refusing to build a transfer against a figure the link got wrong.",
      );
    }
    const source = await chooseSourceAccount(connection, payer, mint, tokenProgramId, rawAmount);
    const destination = getAssociatedTokenAddressSync(mint, recipient, true, tokenProgramId);

    const destinationInfo = await connection.getAccountInfo(destination);
    createsRecipientAccount = destinationInfo === null;

    // The idempotent create rides along whether or not the account exists. It costs nothing when it
    // does — no rent, no state change — and it names the recipient's wallet as an account key, which
    // is what puts the transfer in `getSignaturesForAddress(wallet)`. Without it a token transfer
    // touches only the token account, and the jar page cannot see its own payment.
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        destination,
        recipient,
        mint,
        tokenProgramId,
      ),
    );

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

/** The size of a token account under either program before extensions, which is what rent is quoted on. */
const TOKEN_ACCOUNT_SIZE = 165;

/**
 * What the payer will spend opening the recipient's token account for `mint`, in lamports: zero when
 * the account already exists. The mint's program is not known until the payment is built, so the
 * associated address is checked under both programs and the account counts as present if either
 * answers.
 */
export async function recipientAccountRent(
  connection: Connection,
  mint: PublicKey,
  recipient: PublicKey,
): Promise<bigint> {
  const infos = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getAccountInfo(getAssociatedTokenAddressSync(mint, recipient, true, programId)),
    ),
  );
  if (infos.some((info) => info !== null)) return 0n;
  return BigInt(await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE));
}

export interface SimulationOutcome {
  ok: boolean;
  /** The raw simulation error, when there was one. */
  err: unknown;
  logs: string[];
  /**
   * True when the only failure simulation reported is that the payer cannot cover the transfer.
   *
   * Simulation runs with signature verification off, so this says the transaction is well formed and
   * every program it calls accepted it, with funds the one thing missing that simulation could see.
   * It says nothing about whether a wallet will sign it or whether the payer holds the keys.
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
 * Simulate without signing, and without verifying signatures. A clean result means the transaction
 * is well formed and every program it calls accepted it against current chain state. It does not
 * mean the payer can sign it, and it is not a guarantee about the transaction that finally lands:
 * state can move between here and the wallet prompt.
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

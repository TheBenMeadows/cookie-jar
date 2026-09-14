/**
 * Funds the demo agent's wallet for the cookie-mcp recording: buys TRASHCOIN with the bounty
 * payer's COOK if it is not already held, then sends the agent one invoice's worth plus a little
 * COOK for fees and its token account. Spends real money. Run by hand, never from CI, and only
 * with the payer's say-so.
 *
 *   npx tsx scripts/fund-agent-wallet.ts --dry-run
 *   npx tsx scripts/fund-agent-wallet.ts
 *
 * The agent is meant to be unable to overspend: it receives a little over one invoice and a few
 * cents of COOK, so a wrong tool call runs out of funds rather than out of money. Keys are read
 * from ~/.config/superteam/ and never printed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { getConnection, signatureOutcome } from "../src/lib/chain";
import { COOK_MINT, explorerTxUrl } from "../src/lib/config";
import { rawToUi } from "../src/lib/format";
import { SHOWCASE_AMOUNT, SHOWCASE_DECIMALS, SHOWCASE_MINT } from "../src/lib/showcase";
import { bestSwapQuote, buildSwapTransaction, verifySwapTransaction } from "../src/lib/swap";

const DRY_RUN = process.argv.includes("--dry-run");
const MINT = new PublicKey(SHOWCASE_MINT);

/** A little over the homepage invoice, so one payment fits and a second does not. */
const SEND_RAW = (BigInt(SHOWCASE_AMOUNT) + 100n) * 10n ** BigInt(SHOWCASE_DECIMALS);
/** A signature costs 0.000005 COOK and a token account about 0.002 to open. This is ample and small. */
const SEND_LAMPORTS = 20_000_000n;
/** Sold for TRASHCOIN when the payer does not hold enough. About 830 TRASHCOIN at the 09-14 rate. */
const SWAP_IN_LAMPORTS = 5_000n * 10n ** 9n;

function readKey(file: string): Keypair {
  const keyPath = path.join(os.homedir(), ".config/superteam", file);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8")) as number[]));
}

async function heldByPayer(connection: ReturnType<typeof getConnection>, ata: PublicKey): Promise<bigint> {
  try {
    const { value } = await connection.getTokenAccountBalance(ata);
    return BigInt(value.amount);
  } catch {
    return 0n;
  }
}

async function main(): Promise<void> {
  const payer = readKey("bounty-wallet.json");
  const agent = readKey("agent-demo-wallet.json");
  const connection = getConnection();
  console.log(`payer ${payer.publicKey.toBase58()}`);
  console.log(`agent ${agent.publicKey.toBase58()}`);

  const payerAta = getAssociatedTokenAddressSync(MINT, payer.publicKey);
  const agentAta = getAssociatedTokenAddressSync(MINT, agent.publicKey);

  let held = await heldByPayer(connection, payerAta);
  console.log(`payer holds ${rawToUi(held, SHOWCASE_DECIMALS)}, sending ${rawToUi(SEND_RAW, SHOWCASE_DECIMALS)}`);

  if (held < SEND_RAW) {
    const quote = await bestSwapQuote({
      inputMint: COOK_MINT,
      outputMint: SHOWCASE_MINT,
      rawAmount: SWAP_IN_LAMPORTS.toString(),
    });
    if (!quote) throw new Error("no route COOK to TRASHCOIN");
    console.log(`quote ${quote.aggregator}: ${rawToUi(SWAP_IN_LAMPORTS, 9)} COOK -> ${rawToUi(BigInt(quote.outAmount), SHOWCASE_DECIMALS)} (min ${rawToUi(BigInt(quote.minOutAmount), SHOWCASE_DECIMALS)})`);
    const built = await buildSwapTransaction(quote, payer.publicKey.toBase58());
    const swap = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, "base64"));
    const check = await verifySwapTransaction({ connection, transaction: swap, owner: payer.publicKey, quote });
    if (!check.ok) throw new Error(`swap refused: ${check.reason}`);
    console.log(`swap verified, simulation delivers ${check.expectedOutRaw}`);

    if (DRY_RUN) {
      console.log("DRY-RUN: swap verified, nothing sent; the funding transfer below is simulated against today's balance");
    } else {
      swap.sign([payer]);
      const signature = await connection.sendRawTransaction(swap.serialize());
      console.log(`swap sent ${signature}`);
      console.log(explorerTxUrl(signature));
      const landed = await signatureOutcome(connection, signature);
      if (landed.err) throw new Error(`swap landed and failed: ${JSON.stringify(landed.err)}`);
      held = await heldByPayer(connection, payerAta);
      console.log(`payer now holds ${rawToUi(held, SHOWCASE_DECIMALS)}`);
    }
  }

  const transfer = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: agent.publicKey,
      lamports: SEND_LAMPORTS,
    }),
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, agentAta, agent.publicKey, MINT),
    createTransferCheckedInstruction(
      payerAta,
      MINT,
      agentAta,
      payer.publicKey,
      SEND_RAW,
      SHOWCASE_DECIMALS,
    ),
  );
  transfer.feePayer = payer.publicKey;
  transfer.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  const simulated = await connection.simulateTransaction(transfer);
  if (simulated.value.err && !DRY_RUN) {
    throw new Error(`the funding transfer would fail: ${JSON.stringify(simulated.value.err)}`);
  }
  console.log(
    simulated.value.err
      ? `funding transfer simulates with ${JSON.stringify(simulated.value.err)}, expected on a dry run before the swap has landed`
      : "funding transfer simulates clean",
  );

  if (DRY_RUN) {
    console.log("DRY-RUN: nothing sent");
    return;
  }

  const signature = await connection.sendTransaction(transfer, [payer]);
  console.log(`funding sent ${signature}`);
  console.log(explorerTxUrl(signature));
  const landed = await signatureOutcome(connection, signature);
  if (landed.err) throw new Error(`funding landed and failed: ${JSON.stringify(landed.err)}`);

  const cook = await connection.getBalance(agent.publicKey);
  const { value } = await connection.getTokenAccountBalance(agentAta);
  console.log(`agent holds ${cook / 1e9} COOK and ${value.uiAmountString} TRASHCOIN`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

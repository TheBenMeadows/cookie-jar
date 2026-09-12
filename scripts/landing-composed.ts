/**
 * The funded end-to-end test of the one-transaction checkout: a real swap and a real payment, signed
 * with the bounty wallet's key and sent to Cookie Chain. Spends about one COOK. Run by hand, never
 * from CI, and only with the payer's say-so.
 *
 *   npx tsx scripts/landing-composed.ts
 *
 * The key is read from ~/.config/superteam/bounty-wallet.json (a JSON array of 64 bytes) and never
 * printed. COOK is swapped to TRASHCOIN through whichever router quotes better, and the route's
 * worst-case output is paid to the demo jar under the reference LANDING-COMPOSED, in the same
 * transaction. Afterwards the demo jar is read back to confirm the payment appears with that
 * reference.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { getConnection, signatureOutcome } from "../src/lib/chain";
import { composeSwapAndPayment, lookupTablesOf, verifyComposedCheckout } from "../src/lib/checkout";
import { COOK_MINT, explorerTxUrl } from "../src/lib/config";
import { rawToUi } from "../src/lib/format";
import { fetchJarHistory } from "../src/lib/history";
import { buildPayment, fetchMintFacts } from "../src/lib/pay";
import { settlementOf } from "../src/lib/reconcile";
import { buildMemo } from "../src/lib/request";
import { bestSwapQuote, buildSwapTransaction, verifySwapTransaction } from "../src/lib/swap";

const TRASHCOIN_MINT = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";
const DEMO_JAR = "5ZJsQcVGMqBbuiSQjRT1dBntDp3x8YbfWf359mPdEGwA";
const REF = "LANDING-COMPOSED";
const SWAP_IN_COOK = 1_000_000_000n;

async function main(): Promise<void> {
  const keyPath = path.join(os.homedir(), ".config/superteam/bounty-wallet.json");
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8")) as number[]);
  const payer = Keypair.fromSecretKey(secret);
  const connection = getConnection();
  console.log(`payer ${payer.publicKey.toBase58()}`);

  const quote = await bestSwapQuote({ inputMint: COOK_MINT, outputMint: TRASHCOIN_MINT, rawAmount: SWAP_IN_COOK.toString() });
  if (!quote) throw new Error("no route COOK → TRASHCOIN");
  console.log(`quote ${quote.aggregator}: 1 COOK → ${quote.outAmount} (min ${quote.minOutAmount}) via ${quote.venues.join(" → ")}`);

  const built = await buildSwapTransaction(quote, payer.publicKey.toBase58());
  const swap = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, "base64"));
  const swapCheck = await verifySwapTransaction({ connection, transaction: swap, owner: payer.publicKey, quote });
  if (!swapCheck.ok) throw new Error(`swap refused: ${swapCheck.reason}`);
  console.log(`swap verified, simulation delivers ${swapCheck.expectedOutRaw}`);

  const mint = new PublicKey(TRASHCOIN_MINT);
  const facts = await fetchMintFacts(connection, mint);
  const invoiceRaw = BigInt(quote.minOutAmount);
  const payment = await buildPayment({
    connection,
    payer: payer.publicKey,
    recipient: new PublicKey(DEMO_JAR),
    rawAmount: invoiceRaw,
    mint: TRASHCOIN_MINT,
    decimals: facts.decimals,
    memo: buildMemo({ to: DEMO_JAR, ref: REF, note: "swap and payment in one transaction" }),
    assumeFunded: true,
  });
  const tables = await lookupTablesOf(connection, swap);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const composed = composeSwapAndPayment({
    swap,
    lookupTables: tables,
    payment: payment.transaction.instructions,
    payer: payer.publicKey,
    blockhash,
  });
  if (!composed.ok) throw new Error(`does not fit one transaction (${composed.bytes ?? "over"} bytes)`);
  console.log(`composed ${composed.bytes} bytes, ${composed.transaction.message.compiledInstructions.length} instructions`);

  const destination = getAssociatedTokenAddressSync(mint, new PublicKey(DEMO_JAR), true, facts.programId);
  const check = await verifyComposedCheckout({ connection, transaction: composed.transaction, destination, native: false, rawAmount: invoiceRaw });
  if (!check.ok) throw new Error(`composed refused: ${check.reason}`);
  console.log("composed verified: demo jar receives exactly the invoice");

  composed.transaction.sign([payer]);
  const signature = await connection.sendRawTransaction(composed.transaction.serialize());
  console.log(`sent ${signature}`);
  console.log(explorerTxUrl(signature));
  const landed = await signatureOutcome(connection, signature);
  if (landed.err) throw new Error(`landed and failed: ${JSON.stringify(landed.err)}`);
  console.log(`confirmed, last valid block height ${lastValidBlockHeight}`);

  const history = await fetchJarHistory(connection, new PublicKey(DEMO_JAR), 50);
  const settlement = settlementOf(history.payments, REF, TRASHCOIN_MINT, invoiceRaw);
  const row = settlement.payments.find((p) => p.signature === signature);
  console.log(`jar reads ${REF}: ${settlement.state}, ${rawToUi(settlement.paidRaw, facts.decimals)} TRASHCOIN; row for this signature: ${row ? "yes" : "NO"}`);
  if (!row || settlement.state !== "paid") process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

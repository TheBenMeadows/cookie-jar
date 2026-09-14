/**
 * Live checks against Cookie Chain. Everything here reads the real chain and the real ecosystem
 * APIs; nothing is signed and nothing is sent, so the suite is safe to run from any machine with no
 * key and no funds.
 *
 * Two kinds of transaction check run:
 *   - as a REAL holder, with signature verification off, which proves the whole transaction is
 *     valid end to end (a clean simulation, no error);
 *   - as a FRESH UNFUNDED keypair, which must fail on funds and nothing else — that is the proof
 *     the transaction is otherwise well formed even where no funded wallet is available.
 *
 * Run: `npm run live`
 */
import { Keypair, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { getConnection } from "../src/lib/chain";
import {
  BRIDGE_URL,
  COOKIE_JAR_TREASURY,
  COOK_DECIMALS,
  COOK_MINT,
  COOK_SYMBOL,
  MEMO_PROGRAM_ID,
  ROUND_UP_BPS,
  RPC_URL,
} from "../src/lib/config";
import { fetchDomain, resolveRecipient } from "../src/lib/domains";
import { groupDigits, rawToUi, uiToRaw } from "../src/lib/format";
import { fetchJarHistory, RETENTION_FLOOR_MARGIN_SLOTS } from "../src/lib/history";
import {
  MAX_TRANSACTION_BYTES,
  composeSwapAndPayment,
  lookupTablesOf,
  verifyComposedCheckout,
} from "../src/lib/checkout";
import { buildPayment, roundUpAmount, simulatePayment } from "../src/lib/pay";
import { usdToRaw } from "../src/lib/quote";
import { coversAbsence, paymentsForRef, settlementOf } from "../src/lib/reconcile";
import { buildMemo, decodeRequest, encodeRequest, parseMemo, type PaymentRequest } from "../src/lib/request";
import {
  SHOWCASE_DECIMALS,
  SHOWCASE_LANDED_REF,
  SHOWCASE_MINT,
  SHOWCASE_NAME,
  freshRef,
  showcaseRequest,
} from "../src/lib/showcase";
import { fetchTxDetail } from "../src/lib/txdetail";
import {
  bestSwapQuote,
  buildSwapTransaction,
  quoteFrom,
  verifySwapTransaction,
  type SwapQuote,
} from "../src/lib/swap";
import { fetchCookPriceUsd, fetchToken, searchTokens } from "../src/lib/tokens";

const connection = getConnection();

let passed = 0;
let failed = 0;

function report(name: string, ok: boolean, detail: string): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    report(name, true, await fn());
  } catch (error) {
    report(name, false, error instanceof Error ? error.message : String(error));
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** A `.cook` name that is registered on chain today, discovered rather than assumed. */
const KNOWN_NAME = "cookie.cook";

/** A token with real Cookie Chain liquidity, used for the SPL and swap checks. */
const TRASHCOIN_MINT = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";

/** The jar the README points at. What it holds depends on who has paid it and how long ago. */
const DEMO_JAR = "5ZJsQcVGMqBbuiSQjRT1dBntDp3x8YbfWf359mPdEGwA";

/** The CookOven name the demo jar owns, so every published link can name it instead of its key. */
const DEMO_NAME = "cookietab.cook";

/** A payment into that jar, read off the chain. It leaves the node when the window rolls past it. */
const DEMO_PAYMENT = {
  signature:
    "HmqbY8zgeZQBXr8L9iAwDaJmtFrC6cfyEjzNwPGZSfd48QyQJtz7hsQB6mYQ2o6UKX1NAUvxZaUGeG7qYvftsHn",
  rawAmount: 1_200_000_000_000n,
  ref: "INV-2026-014",
};

/** Somewhere for the test payments to point. Never receives anything — nothing is ever sent. */
const SINK = Keypair.generate().publicKey;

async function findFundedWallet(minLamports: bigint): Promise<PublicKey> {
  // Wallets that registered `.cook` names, so they held at least the registration price at some
  // point. Checked live; the first one still holding enough is used.
  const candidates = [
    "4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx",
    "AuCPPPDywCr9tq3LrYC4cGM5mpfYpZy1ZKYhshZvPtFj",
    "AmZDfCaqwzqnCiiu3Go91BJGctrKsUBQS4ydR3SAao7i",
  ];
  for (const candidate of candidates) {
    const key = new PublicKey(candidate);
    const balance = await connection.getBalance(key);
    if (BigInt(balance) >= minLamports) return key;
  }
  throw new Error("no candidate wallet on Cookie Chain still holds enough COOK to simulate against");
}

/** The largest holder of `mint` whose token account belongs to an ordinary wallet, not a program. */
async function findTokenHolder(
  mint: PublicKey,
): Promise<{ owner: PublicKey; raw: bigint; decimals: number }> {
  const largest = await connection.getTokenLargestAccounts(mint);
  for (const account of largest.value.slice(0, 10)) {
    const info = await connection.getParsedAccountInfo(account.address);
    const data = info.value?.data;
    if (!data || !("parsed" in data)) continue;
    const owner = data.parsed?.info?.owner;
    if (typeof owner !== "string") continue;
    const ownerInfo = await connection.getAccountInfo(new PublicKey(owner));
    if (!ownerInfo || !ownerInfo.owner.equals(SystemProgram.programId)) continue;
    return {
      owner: new PublicKey(owner),
      raw: BigInt(account.amount),
      decimals: account.decimals,
    };
  }
  throw new Error(`no wallet-owned holder of ${mint.toBase58()} found among the largest accounts`);
}

async function main(): Promise<void> {
  console.log(`Cookie Tab live checks — RPC ${RPC_URL}\n`);

  await check("rpc reachable", async () => {
    const version = await connection.getVersion();
    const slot = await connection.getSlot();
    assert(slot > 0, "the chain reported slot 0");
    return `solana-core ${version["solana-core"]}, slot ${slot}`;
  });

  await check("link encode/decode round-trip", async () => {
    const request: PaymentRequest = {
      to: KNOWN_NAME,
      label: "Bakery Tab",
      note: "one dozen, sesame",
      amount: "25000",
      ref: "INV-0007",
    };
    const encoded = encodeRequest(request);
    const decoded = decodeRequest(encoded);
    assert(decoded.to === KNOWN_NAME, `recipient came back as ${decoded.to}`);
    assert(decoded.amount === "25000", `amount came back as ${decoded.amount}`);
    assert(decoded.note === "one dozen, sesame", `note came back as ${decoded.note}`);
    assert(decoded.ref === "INV-0007", `reference came back as ${decoded.ref}`);
    assert(encodeRequest(decoded) === encoded, "re-encoding the decoded request changed the link");

    const memo = buildMemo(decoded);
    const parsedMemo = parseMemo(memo);
    assert(parsedMemo?.ref === "INV-0007", "the memo lost its reference");
    assert(parsedMemo?.note === "one dozen, sesame", "the memo lost its note");
    assert(parseMemo("hello world") === null, "a foreign memo was read as a Cookie Tab payment");

    return `${encoded.length} characters, memo "${memo}"`;
  });

  await check("link rejects a damaged payload", async () => {
    let threw = false;
    try {
      decodeRequest("not-a-real-payload");
    } catch {
      threw = true;
    }
    assert(threw, "a damaged link decoded without complaint");
    return "a damaged payload is refused rather than half-read";
  });

  await check(".cook name resolves on chain", async () => {
    const domain = await fetchDomain(connection, KNOWN_NAME);
    assert(domain !== null, `${KNOWN_NAME} is not registered`);
    const resolved = await resolveRecipient(connection, KNOWN_NAME);
    assert(
      resolved.address.toBase58() === domain?.owner,
      "resolveRecipient and the registry disagree on the owner",
    );
    assert(resolved.name === KNOWN_NAME, "the resolved name was not carried through");
    return `${KNOWN_NAME} → ${resolved.address.toBase58()} (registry account ${domain?.name}, legacy=${domain?.legacy})`;
  });

  await check("the demo jar's own .cook name resolves to it", async () => {
    // Every link published for this entry names the jar rather than its base58 key, so the name has
    // to keep resolving to the same account the jar pages read.
    const resolved = await resolveRecipient(connection, DEMO_NAME);
    assert(
      resolved.address.toBase58() === DEMO_JAR,
      `${DEMO_NAME} resolves to ${resolved.address.toBase58()}, not the demo jar`,
    );
    assert(resolved.name === DEMO_NAME, `the name came back as ${resolved.name}`);
    return `${DEMO_NAME} → ${DEMO_JAR}`;
  });

  await check(".cook name that is not registered is refused", async () => {
    const missing = "definitely-not-registered-x";
    const domain = await fetchDomain(connection, missing);
    assert(domain === null, `${missing}.cook unexpectedly exists`);
    let threw = false;
    try {
      await resolveRecipient(connection, `${missing}.cook`);
    } catch {
      threw = true;
    }
    assert(threw, "an unregistered name resolved to an address");
    return `${missing}.cook resolves to nothing, and paying it is refused`;
  });

  let cookPrice: number | null = null;
  await check("USD quote from the Cookiescan price feed", async () => {
    // Through the same call the Create page makes. The dollar option is offered only when the
    // selected token carries a price, so a native token that comes back unpriced silently disables
    // dollar-quoted requests.
    const native = await fetchToken(COOK_MINT);
    assert(native !== null, `the asset registry returned nothing for ${COOK_MINT}`);
    assert(
      native?.priceUsd !== null && (native?.priceUsd ?? 0) > 0,
      "the native token came back unpriced, which disables dollar-quoted requests on the Create page",
    );
    assert(native?.mint === COOK_MINT, `the native token came back with mint ${native?.mint}`);
    assert(native?.decimals === COOK_DECIMALS, `the native token came back with ${native?.decimals} decimals`);

    cookPrice = await fetchCookPriceUsd();
    assert(cookPrice !== null && cookPrice > 0, "Cookiescan returned no COOK price");
    assert(cookPrice === native?.priceUsd, "the two native price paths disagree");
    const raw = usdToRaw("25.00", cookPrice as number, COOK_DECIMALS);
    const ui = rawToUi(raw, COOK_DECIMALS);
    const backToUsd = Number(ui) * (cookPrice as number);
    assert(Math.abs(backToUsd - 25) < 0.01, `$25 round-tripped to $${backToUsd.toFixed(4)}`);
    return `${native?.symbol} = $${cookPrice} from /v1/assets/cook (mint ${native?.mint}, ${native?.decimals} decimals); $25.00 = ${groupDigits(ui)} ${COOK_SYMBOL}`;
  });

  await check("token registry search", async () => {
    const results = await searchTokens("trash", 5);
    assert(results.length > 0, "the registry matched nothing for 'trash'");
    const trash = await fetchToken(TRASHCOIN_MINT);
    assert(trash !== null, "TRASHCOIN is not in the registry");
    assert(trash?.decimals === 9, `TRASHCOIN reported ${trash?.decimals} decimals`);
    return `${results.length} matches; ${trash?.symbol} has ${trash?.decimals} decimals at $${trash?.priceUsd}`;
  });

  await check("COOK payment simulates clean from a funded wallet", async () => {
    const rawAmount = uiToRaw("1000", COOK_DECIMALS);
    const payer = await findFundedWallet(rawAmount + 10_000_000n);
    const { transaction } = await buildPayment({
      connection,
      payer,
      recipient: SINK,
      rawAmount,
      decimals: COOK_DECIMALS,
      memo: buildMemo({ to: SINK.toBase58(), note: "live check", ref: "LIVE-1" }),
    });
    const outcome = await simulatePayment(connection, transaction);
    assert(outcome.ok, `simulation failed: ${outcome.message ?? JSON.stringify(outcome.err)}`);
    assert(
      outcome.logs.some((l) => l.includes("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")),
      "the memo program did not run",
    );
    return `1,000 ${COOK_SYMBOL} from ${payer.toBase58()}, ${outcome.logs.length} log lines, memo executed`;
  });

  await check("COOK payment with the Cookie Jar round-up simulates, and the treasury is a wallet", async () => {
    // The treasury has to be an ordinary system-owned wallet, the same rule the app applies to a
    // `.cook` name in escrow: a program-owned account would take the money where nobody can spend it.
    const treasury = new PublicKey(COOKIE_JAR_TREASURY);
    const info = await connection.getAccountInfo(treasury);
    assert(info !== null, "the Cookie Jar treasury account does not exist on this chain");
    assert(
      info?.owner.equals(SystemProgram.programId) === true,
      `the treasury is owned by ${info?.owner.toBase58()}, not the system program`,
    );

    const rawAmount = uiToRaw("1000", COOK_DECIMALS);
    const share = roundUpAmount(rawAmount, ROUND_UP_BPS);
    const payer = await findFundedWallet(rawAmount + share + 10_000_000n);
    const { transaction } = await buildPayment({
      connection,
      payer,
      recipient: SINK,
      rawAmount,
      decimals: COOK_DECIMALS,
      memo: buildMemo({ to: SINK.toBase58(), note: "live check", ref: "LIVE-ROUNDUP" }),
      roundUp: { to: treasury, rawAmount: share },
    });
    const before = BigInt(await connection.getBalance(treasury));
    const simulation = await connection.simulateTransaction(transaction, undefined, [treasury]);
    assert(!simulation.value.err, `simulation failed: ${JSON.stringify(simulation.value.err)}`);
    const after = simulation.value.accounts?.[0]?.lamports;
    assert(after !== undefined, "the simulation did not report the treasury's balance");
    assert(
      BigInt(after ?? 0) - before === share,
      `the treasury would gain ${BigInt(after ?? 0) - before} lamports rather than ${share}`,
    );
    return `treasury ${COOKIE_JAR_TREASURY} is system-owned holding ${rawToUi(BigInt(info?.lamports ?? 0), COOK_DECIMALS)} ${COOK_SYMBOL}; 1,000 ${COOK_SYMBOL} + ${rawToUi(share, COOK_DECIMALS)} ${COOK_SYMBOL} round-up simulates, treasury gains exactly the share`;
  });

  await check("COOK payment from an unfunded payer fails on funds alone", async () => {
    const payer = Keypair.generate().publicKey;
    const { transaction } = await buildPayment({
      connection,
      payer,
      recipient: SINK,
      rawAmount: uiToRaw("1000", COOK_DECIMALS),
      decimals: COOK_DECIMALS,
      memo: buildMemo({ to: SINK.toBase58(), note: "live check" }),
    });
    const outcome = await simulatePayment(connection, transaction);
    assert(!outcome.ok, "an empty wallet simulated a successful payment");
    assert(
      outcome.insufficientFunds,
      `the failure was not about funds: ${JSON.stringify(outcome.err)} ${outcome.logs.join(" | ")}`,
    );
    return `${payer.toBase58()} holds nothing; the only error is ${JSON.stringify(outcome.err)} (unfundedAccount=${outcome.unfundedAccount}), so the transaction is otherwise valid`;
  });

  await check("SPL token payment simulates clean from a real holder", async () => {
    const mint = new PublicKey(TRASHCOIN_MINT);
    const holder = await findTokenHolder(mint);
    const rawAmount = holder.raw / 1000n > 0n ? holder.raw / 1000n : 1n;
    const built = await buildPayment({
      connection,
      payer: holder.owner,
      recipient: SINK,
      rawAmount,
      mint: TRASHCOIN_MINT,
      decimals: holder.decimals,
      memo: buildMemo({ to: SINK.toBase58(), note: "live check", ref: "LIVE-2" }),
    });
    const outcome = await simulatePayment(connection, built.transaction);
    assert(outcome.ok, `simulation failed: ${outcome.message ?? JSON.stringify(outcome.err)}`);
    const program = built.tokenProgramId?.equals(TOKEN_2022_PROGRAM_ID)
      ? "Token-2022"
      : built.tokenProgramId?.equals(TOKEN_PROGRAM_ID)
        ? "Token"
        : "unknown";
    return `${rawToUi(rawAmount, holder.decimals)} tokens from ${holder.owner.toBase58()} over ${program}; recipient account created in the same transaction: ${built.createsRecipientAccount}`;
  });

  await check("a link that lies about a token's decimals is refused", async () => {
    const mint = new PublicKey(TRASHCOIN_MINT);
    const holder = await findTokenHolder(mint);
    let message = "";
    try {
      await buildPayment({
        connection,
        payer: holder.owner,
        recipient: SINK,
        rawAmount: 1n,
        mint: TRASHCOIN_MINT,
        decimals: holder.decimals === 6 ? 9 : 6,
        memo: buildMemo({ to: SINK.toBase58(), note: "live check" }),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert(/decimals/.test(message), `a wrong decimals figure was accepted: ${message || "no error"}`);
    return `the chain's ${holder.decimals} decimals for TRASHCOIN beat the link's claim: ${message}`;
  });

  await check("a payment to the connected wallet's own jar is refused", async () => {
    const payer = Keypair.generate().publicKey;
    let threw = false;
    try {
      await buildPayment({
        connection,
        payer,
        recipient: payer,
        rawAmount: 1n,
        decimals: COOK_DECIMALS,
        memo: "x",
      });
    } catch {
      threw = true;
    }
    assert(threw, "a wallet was allowed to build a payment to itself");
    return "paying your own jar is refused before a transaction is built";
  });

  await check("swap quote from the aggregators", async () => {
    const quote = await bestSwapQuote({
      inputMint: TRASHCOIN_MINT,
      outputMint: COOK_MINT,
      rawAmount: uiToRaw("1000", 9).toString(),
    });
    assert(quote !== null, "neither aggregator found a route for TRASHCOIN → COOK");
    assert(BigInt(quote?.outAmount ?? "0") > 0n, "the winning quote returned nothing out");
    assert(
      BigInt(quote?.minOutAmount ?? "0") <= BigInt(quote?.outAmount ?? "0"),
      "the quote's minimum out is larger than its expected out",
    );
    return `${quote?.aggregator}: 1,000 TRASHCOIN → ${rawToUi(BigInt(quote?.outAmount ?? "0"), COOK_DECIMALS)} ${COOK_SYMBOL} via ${quote?.venues.join(" → ")}`;
  });

  for (const aggregator of ["cookiebox", "candyshop"] as const) {
    await check(`${aggregator} builds a swap transaction that simulates`, async () => {
      const mint = new PublicKey(TRASHCOIN_MINT);
      const holder = await findTokenHolder(mint);
      const rawAmount = holder.raw / 1000n > 0n ? holder.raw / 1000n : 1n;
      const quote = await quoteFrom(aggregator, {
        inputMint: TRASHCOIN_MINT,
        outputMint: COOK_MINT,
        rawAmount: rawAmount.toString(),
      });
      assert(quote !== null, `${aggregator} found no route for TRASHCOIN → ${COOK_SYMBOL}`);

      const built = await buildSwapTransaction(quote as SwapQuote, holder.owner.toBase58());
      const transaction = VersionedTransaction.deserialize(
        new Uint8Array(Buffer.from(built.transactionBase64, "base64")),
      );
      assert(
        transaction.message.staticAccountKeys[0]?.toBase58() === holder.owner.toBase58(),
        "the aggregator built a transaction whose fee payer is not the swapper",
      );
      const simulation = await connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        sigVerify: false,
      });
      assert(
        !simulation.value.err,
        `the swap did not simulate: ${JSON.stringify(simulation.value.err)} ${simulation.value.logs?.slice(-3).join(" | ")}`,
      );
      return `${rawToUi(rawAmount, holder.decimals)} TRASHCOIN → ${COOK_SYMBOL} for ${holder.owner.toBase58()}, unsigned, fee payer is the swapper`;
    });
  }

  await check("a swap that sells native COOK passes verification for a funded wallet", async () => {
    // The direction a first-time payer takes: COOK in, a token out. The input leaves the same
    // balance the fee comes from, and verification has to allow exactly that and nothing more.
    const rawAmount = uiToRaw("1", COOK_DECIMALS);
    const payer = await findFundedWallet(rawAmount + 100_000_000n);
    const quote = await bestSwapQuote({
      inputMint: COOK_MINT,
      outputMint: TRASHCOIN_MINT,
      rawAmount: rawAmount.toString(),
    });
    assert(quote !== null, `no route for ${COOK_SYMBOL} → TRASHCOIN`);
    const built = await buildSwapTransaction(quote as SwapQuote, payer.toBase58());
    const transaction = VersionedTransaction.deserialize(
      new Uint8Array(Buffer.from(built.transactionBase64, "base64")),
    );
    const check_ = await verifySwapTransaction({ connection, transaction, owner: payer, quote: quote as SwapQuote });
    assert(check_.ok, check_.reason ?? "the swap was refused");
    return `${quote?.aggregator}: 1 ${COOK_SYMBOL} → TRASHCOIN for ${payer.toBase58()} verified, simulation delivers ${check_.expectedOutRaw} base units`;
  });

  for (const aggregator of ["cookiebox", "candyshop"] as const) {
    await check(`${aggregator} swap and a payment compose into one transaction`, async () => {
      // The one-signature checkout: the router's swap with a COOK payment behind it, recompiled as
      // one message and simulated together. The recipient is the demo jar and the amount is the
      // route's worst case, so the payment is covered by the swap alone.
      const mint = new PublicKey(TRASHCOIN_MINT);
      const holder = await findTokenHolder(mint);
      const rawAmount = holder.raw / 1000n > 0n ? holder.raw / 1000n : 1n;
      const quote = await quoteFrom(aggregator, {
        inputMint: TRASHCOIN_MINT,
        outputMint: COOK_MINT,
        rawAmount: rawAmount.toString(),
      });
      assert(quote !== null, `${aggregator} found no route for TRASHCOIN → ${COOK_SYMBOL}`);
      const built = await buildSwapTransaction(quote as SwapQuote, holder.owner.toBase58());
      const swap = VersionedTransaction.deserialize(
        new Uint8Array(Buffer.from(built.transactionBase64, "base64")),
      );
      const payment = await buildPayment({
        connection,
        payer: holder.owner,
        recipient: new PublicKey(DEMO_JAR),
        rawAmount: BigInt((quote as SwapQuote).minOutAmount),
        decimals: COOK_DECIMALS,
        memo: buildMemo({ to: DEMO_JAR, ref: "LIVE-CHECK", note: "composed swap and payment" }),
        assumeFunded: true,
      });
      const tables = await lookupTablesOf(connection, swap);
      const composed = composeSwapAndPayment({
        swap,
        lookupTables: tables,
        payment: payment.transaction.instructions,
        payer: holder.owner,
        blockhash: payment.blockhash,
      });
      if (!composed.ok) {
        // A route too long to share a transaction with the payment is the documented case the
        // two-step checkout exists for; what matters is that it was refused rather than sent.
        return `${aggregator} route ${quote?.venues.join(" → ")}: ${composed.bytes ?? "over"} bytes with the payment, past the ${MAX_TRANSACTION_BYTES}-byte limit, so this pair falls back to swap-then-pay`;
      }
      const check_ = await verifyComposedCheckout({
        connection,
        transaction: composed.transaction,
        destination: new PublicKey(DEMO_JAR),
        native: true,
        rawAmount: BigInt((quote as SwapQuote).minOutAmount),
      });
      assert(check_.ok, check_.reason ?? "the composed transaction failed its check");
      return `${aggregator} route ${quote?.venues.join(" → ")}: ${composed.bytes} bytes, ${composed.transaction.message.compiledInstructions.length} instructions, one signer; simulated together, the demo jar receives exactly ${rawToUi(BigInt((quote as SwapQuote).minOutAmount), COOK_DECIMALS)} ${COOK_SYMBOL}`;
    });
  }

  await check("jar history reads from chain", async () => {
    // Read against the memo program rather than a jar: every Cookie Tab payment on the chain calls
    // it, so it is the one address with activity inside the RPC's window on any day this runs. What
    // is being checked is the read path — that signatures come back and parse — not a balance.
    const history = await fetchJarHistory(connection, MEMO_PROGRAM_ID, 20);
    assert(Array.isArray(history.payments), "history did not come back as a list");
    assert(history.scanned > 0, "the scan read no signatures at all");
    return `${MEMO_PROGRAM_ID.toBase58()}: ${history.scanned} signatures read, ${history.payments.length} parsed as payments to that address (cap hit: ${history.hitCap})`;
  });

  await check("the demo jar's history answers in the right shape", async () => {
    const jar = new PublicKey(DEMO_JAR);
    const history = await fetchJarHistory(connection, jar, 20);
    assert(Array.isArray(history.payments), "history did not come back as a list");
    assert(typeof history.hitCap === "boolean", "hitCap did not come back as a flag");
    assert(typeof history.stoppedAtLimit === "boolean", "stoppedAtLimit did not come back as a flag");
    for (const payment of history.payments) {
      assert(payment.rawAmount > 0n, "a history row recorded a non-positive amount");
      assert(payment.signature.length > 0, "a history row has no signature");
    }
    // An address with nothing inside the node's retention window is the documented limit, not a
    // fault: the read above is what says the path works.
    if (history.scanned === 0) {
      return `${DEMO_JAR}: no activity inside this RPC's retention window, so there is nothing for a jar to list`;
    }

    // While the window still holds it, a known payment is read back in full: the amount and the
    // reference a payer put on chain, rebuilt from the chain alone. The node is asked first whether
    // it still holds that signature, because the jar can have newer activity inside the window
    // after the demo payment has dropped out of it.
    const status = await connection.getSignatureStatuses([DEMO_PAYMENT.signature], {
      searchTransactionHistory: true,
    });
    if (status.value[0] === null) {
      return `${DEMO_JAR}: ${history.payments.length} Cookie Tab payments in ${history.scanned} signatures scanned; the demo payment ${DEMO_PAYMENT.signature.slice(0, 10)}… is older than this RPC's retention window, so it cannot be listed`;
    }
    const known = history.payments.find((p) => p.signature === DEMO_PAYMENT.signature);
    assert(known !== undefined, `the jar did not list payment ${DEMO_PAYMENT.signature}`);
    assert(
      known?.rawAmount === DEMO_PAYMENT.rawAmount,
      `that payment came back as ${known?.rawAmount} base units rather than ${DEMO_PAYMENT.rawAmount}`,
    );
    assert(known?.ref === DEMO_PAYMENT.ref, `that payment's reference came back as ${known?.ref}`);
    assert(known?.mint === COOK_MINT, `that payment came back against mint ${known?.mint}`);

    return `${DEMO_JAR}: ${history.payments.length} Cookie Tab payments in ${history.scanned} signatures scanned (cap hit: ${history.hitCap}, stopped at limit: ${history.stoppedAtLimit}); ${groupDigits(rawToUi(known?.rawAmount ?? 0n, COOK_DECIMALS))} ${COOK_SYMBOL} ref ${known?.ref} from ${known?.from} reads back from ${DEMO_PAYMENT.signature.slice(0, 10)}…`;
  });

  await check("a reference settles against the demo jar", async () => {
    // The receipt page and the already-paid notice both rest on this: the jar's payments, filtered
    // by the reference the memo carries, judged against the amount the request asked for.
    const history = await fetchJarHistory(connection, new PublicKey(DEMO_JAR), 50);
    const coverage = {
      scanned: history.scanned,
      hitCap: history.hitCap,
      stoppedAtLimit: history.stoppedAtLimit,
      reachedRetentionFloor: history.reachedRetentionFloor,
    };
    const status = await connection.getSignatureStatuses([DEMO_PAYMENT.signature], {
      searchTransactionHistory: true,
    });
    if (status.value[0] === null) {
      const gone = settlementOf(history.payments, DEMO_PAYMENT.ref, COOK_MINT, DEMO_PAYMENT.rawAmount, coverage);
      assert(gone.state !== "paid", `${DEMO_PAYMENT.ref} reads paid with its payment outside the window`);
      return `the demo payment is outside this RPC's retention window; ${DEMO_PAYMENT.ref} reads as ${gone.state}, which is the documented limit`;
    }
    const paid = settlementOf(history.payments, DEMO_PAYMENT.ref, COOK_MINT, DEMO_PAYMENT.rawAmount, coverage);
    assert(paid.state === "paid", `${DEMO_PAYMENT.ref} reads as ${paid.state} with ${paid.paidRaw} base units`);
    assert(paid.payments.length >= 1, `${DEMO_PAYMENT.ref} matched no payment`);
    const partial = settlementOf(history.payments, DEMO_PAYMENT.ref, COOK_MINT, DEMO_PAYMENT.rawAmount * 2n, coverage);
    assert(partial.state === "partial", `asked for double, ${DEMO_PAYMENT.ref} reads as ${partial.state}`);

    // A reference nobody has paid reads `unpaid` only when the jar was read to its end; on a
    // truncated read the honest answer is `unknown`, and the receipt page says so rather than
    // calling a settled invoice unpaid.
    const none = settlementOf(history.payments, "INV-NEVER-PAID", COOK_MINT, 1n, coverage);
    assert(none.payments.length === 0, "an unknown reference matched a payment");
    const readToEnd = coversAbsence(coverage);
    assert(
      none.state === (readToEnd ? "unpaid" : "unknown"),
      `with coverage ${JSON.stringify(coverage)} an unpaid reference read as ${none.state}`,
    );
    const blind = settlementOf(history.payments, "INV-NEVER-PAID", COOK_MINT, 1n, null);
    assert(blind.state === "unknown", `without coverage an absence read as ${blind.state}`);
    return `${DEMO_PAYMENT.ref}: paid, ${groupDigits(rawToUi(paid.paidRaw, COOK_DECIMALS))} ${COOK_SYMBOL} across ${paid.payments.length} payment(s); partial when asked for double; INV-NEVER-PAID ${none.state} (scanned ${coverage.scanned}, cap ${coverage.hitCap}, limit ${coverage.stoppedAtLimit})`;
  });

  await check("the homepage invoice is payable and its last landing reads back as one signature", async () => {
    // The homepage leads with a fixed invoice on the demo jar. Its token facts are hard-coded so
    // the page paints before any RPC call, which means the registry is the thing to check them
    // against: a decimals mismatch would price the invoice a thousand times off.
    const token = await fetchToken(SHOWCASE_MINT);
    assert(token !== null, `the registry has no entry for ${SHOWCASE_MINT}`);
    assert(
      token?.decimals === SHOWCASE_DECIMALS,
      `the registry says ${SHOWCASE_MINT} has ${token?.decimals} decimals, the homepage assumes ${SHOWCASE_DECIMALS}`,
    );
    const request = decodeRequest(encodeRequest(showcaseRequest(freshRef())));
    assert(request.to === SHOWCASE_NAME, `the invoice names ${request.to}`);
    assert(request.ref?.startsWith("TAB-") === true, `the invoice reference came back as ${request.ref}`);

    // Under the button the page shows the last payment landed under the refresh job's reference,
    // with the transaction's shape read from the chain. That is only possible while the node still
    // holds it, and the page says so when it does not.
    const history = await fetchJarHistory(connection, new PublicKey(DEMO_JAR), 10);
    const [latest] = paymentsForRef(history.payments, SHOWCASE_LANDED_REF);
    if (!latest) {
      return `${SHOWCASE_NAME}: ${request.amount} ${request.symbol} invoice encodes under ${request.ref}; no ${SHOWCASE_LANDED_REF} payment inside this RPC's window, so the homepage shows the no-record notice`;
    }
    const detail = await fetchTxDetail(connection, latest.signature);
    assert(detail !== null, `the node lists ${latest.signature} but will not return it`);
    assert(detail?.signatures === 1, `the landed checkout carried ${detail?.signatures} signatures`);
    assert(detail?.hasMemo === true, "the landed checkout carries no memo");
    assert((detail?.instructions ?? 0) >= 3, `the landed checkout has only ${detail?.instructions} instructions`);
    return `${SHOWCASE_NAME}: ${request.amount} ${request.symbol} invoice encodes under ${request.ref}; ${SHOWCASE_LANDED_REF} last landed ${latest.signature.slice(0, 10)}… as ${detail?.instructions} instructions, ${detail?.signatures} signature, through ${detail?.programs.map((p) => p.slice(0, 6)).join(", ")}`;
  });

  await check("a jar read reports whether it ran into this RPC's retention floor", async () => {
    // The distinction the receipt page rests on: consuming every signature a node will return is
    // not the same as seeing a jar's whole life. A jar older than the window ends its history at
    // the node's earliest block, and an invoice settled before that must read as no record rather
    // than as unpaid.
    const [history, firstBlock] = await Promise.all([
      fetchJarHistory(connection, new PublicKey(DEMO_JAR), 50),
      connection.getFirstAvailableBlock(),
    ]);
    assert(
      typeof history.reachedRetentionFloor === "boolean",
      "a jar read did not report whether it reached the retention floor",
    );
    const signatures = await connection.getSignaturesForAddress(new PublicKey(DEMO_JAR), {
      limit: 1000,
    });
    const oldest = signatures[signatures.length - 1];
    if (!oldest) {
      assert(
        history.reachedRetentionFloor,
        "a jar the node holds nothing for claimed to have read past the floor",
      );
      return `${DEMO_JAR}: no signatures inside the window, so absence is not evidence and the page says no record`;
    }
    const above = oldest.slot - firstBlock;
    assert(
      history.reachedRetentionFloor === above <= RETENTION_FLOOR_MARGIN_SLOTS,
      `oldest signature sits ${above} slots above block ${firstBlock} but the read reported reachedRetentionFloor=${history.reachedRetentionFloor}`,
    );
    return `${DEMO_JAR}: oldest of ${signatures.length} signatures at slot ${oldest.slot}, ${above} slots above the floor ${firstBlock}; margin ${RETENTION_FLOOR_MARGIN_SLOTS}, so reachedRetentionFloor=${history.reachedRetentionFloor} and an absence ${coversAbsence(history) ? "is" : "is not"} evidence`;
  });

  await check("how far back a jar can see on this RPC", async () => {
    // `getSignaturesForAddress` can only answer for blocks the node still holds. This is not a
    // failure — it is the number that decides how much history a jar shows, so it is measured rather
    // than assumed, and the README quotes it.
    const [slot, firstBlock] = await Promise.all([
      connection.getSlot(),
      connection.getFirstAvailableBlock(),
    ]);
    const slots = slot - firstBlock;
    const days = (slots * 0.4) / 86_400;
    assert(slots > 0, "the node reports no retained blocks at all");
    return `slot ${slot}, first available block ${firstBlock}: ${slots.toLocaleString("en-US")} slots retained, about ${days.toFixed(1)} days at 400 ms per slot`;
  });

  await check("bridge is reachable for payers with no COOK", async () => {
    const response = await fetch(BRIDGE_URL, { redirect: "follow" });
    assert(response.ok, `the bridge answered HTTP ${response.status}`);
    return `${BRIDGE_URL} → HTTP ${response.status} at ${response.url}`;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getConnection, signatureOutcome, waitForSignature } from "../lib/chain";
import {
  composeSwapAndPayment,
  lookupTablesOf,
  verifyComposedCheckout,
} from "../lib/checkout";
import { COOK_MINT, explorerTxUrl } from "../lib/config";
import { fetchNativeBalance, fetchTokenHoldings, type Holding } from "../lib/balances";
import { groupDigits, rawToUi, shortAddress, uiToRaw } from "../lib/format";
import {
  bestSwapQuote,
  buildSwapTransaction,
  verifySwapTransaction,
  type SwapQuote,
} from "../lib/swap";
import { fetchToken } from "../lib/tokens";

/**
 * The swap step, for a payer who holds the wrong token. Cookie Tab quotes both Cookie Chain
 * aggregators and hands the winning route to the payer's own wallet to sign — the funds never pass
 * through this app. With a checkout attached, the swap and the payment go to the wallet as one
 * transaction that lands together or not at all; without one, or when the two do not fit in one
 * transaction, the swap is its own transaction and the payment follows.
 */

/** The payment this swap is for, so the two can share a transaction. */
export interface Checkout {
  /** Base units of the target token the payer already holds and can spend. */
  heldRaw: bigint;
  /** Everything the transaction takes from the payer in the target token: the payment plus any round-up. */
  rawAmount: bigint;
  /** What the recipient alone receives, which is what the combined simulation is checked against. */
  recipientRaw: bigint;
  /** The payment's instructions and where the money lands: the recipient's wallet, or their token account. */
  build: () => Promise<{
    instructions: TransactionInstruction[];
    destination: PublicKey;
    native: boolean;
  }>;
  onPaid: (signature: string) => void;
  onFailed: (signature: string, err: unknown) => void;
}

interface Props {
  owner: PublicKey;
  targetMint: string;
  targetDecimals: number;
  targetSymbol: string;
  /** How much more of the target token the payer needs, in base units. */
  shortfallRaw: bigint;
  onSwapped: () => void;
  checkout?: Checkout;
}

interface Candidate extends Holding {
  priceUsd: number | null;
}

type Phase = "idle" | "preparing" | "confirm" | "composing" | "signing" | "landing" | "done";

interface Prepared {
  transaction: VersionedTransaction;
  /** What the simulation showed arriving, not what the router quoted. */
  expectedOutRaw: bigint;
}

export function SwapPanel(props: Props): JSX.Element {
  const { signTransaction } = useWallet();
  const connection = useMemo(() => getConnection(), []);

  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [inputAmount, setInputAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set once this route and payment were found not to fit one transaction, so the offer is withdrawn. */
  const [twoStepOnly, setTwoStepOnly] = useState(false);

  const checkout = props.checkout;
  const coversPayment =
    checkout !== undefined &&
    prepared !== null &&
    !twoStepOnly &&
    prepared.expectedOutRaw + checkout.heldRaw >= checkout.rawAmount;

  const sourceHolding = candidates?.find((c) => c.mint === source) ?? null;
  /** Which token the field is being seeded for, readable from inside a suggestion still in flight. */
  const seedingFor = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [native, tokens] = await Promise.all([
        fetchNativeBalance(connection, props.owner),
        fetchTokenHoldings(connection, props.owner),
      ]);
      const held = [native, ...tokens].filter(
        (h) => h.mint !== props.targetMint && h.raw > 0n,
      );
      const priced = await Promise.all(
        held.slice(0, 8).map(async (h): Promise<Candidate> => {
          const token = await fetchToken(h.mint === COOK_MINT ? "cook" : h.mint).catch(() => null);
          return { ...h, symbol: token?.symbol ?? h.symbol, priceUsd: token?.priceUsd ?? null };
        }),
      );
      if (live) setCandidates(priced);
    })().catch((e: unknown) => {
      if (live) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      live = false;
    };
  }, [connection, props.owner, props.targetMint]);

  /**
   * A first guess at how much to swap, from the two Cookiescan prices plus 3% headroom for the
   * route's own price impact. It only seeds the field — the quote below it is what the router
   * actually offers, and the payer can change the number.
   */
  const suggestInput = useCallback(
    async (holding: Candidate): Promise<string> => {
      const target = await fetchToken(
        props.targetMint === COOK_MINT ? "cook" : props.targetMint,
      ).catch(() => null);
      const targetPrice = target?.priceUsd;
      if (!targetPrice || !holding.priceUsd) return rawToUi(holding.raw, holding.decimals);
      const shortfallUi = Number(rawToUi(props.shortfallRaw, props.targetDecimals));
      const needUsd = shortfallUi * targetPrice * 1.03;
      const inputUi = needUsd / holding.priceUsd;
      const capped = Math.min(inputUi, Number(rawToUi(holding.raw, holding.decimals)));
      return capped.toFixed(Math.min(holding.decimals, 6));
    },
    [props.targetMint, props.targetDecimals, props.shortfallRaw],
  );

  const requestQuote = useCallback(async () => {
    if (!sourceHolding || !inputAmount.trim()) return;
    setError(null);
    setQuoting(true);
    setQuote(null);
    try {
      const raw = uiToRaw(inputAmount, sourceHolding.decimals);
      if (raw <= 0n) throw new Error("enter an amount to swap");
      if (raw > sourceHolding.raw) throw new Error("that is more than this wallet holds");
      const result = await bestSwapQuote({
        inputMint: sourceHolding.mint,
        outputMint: props.targetMint,
        rawAmount: raw.toString(),
      });
      if (!result) throw new Error("neither aggregator found a route between these two tokens");
      setQuote(result);
      setPrepared(null);
      setPhase("idle");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuoting(false);
    }
  }, [sourceHolding, inputAmount, props.targetMint]);

  /**
   * Build the swap and check it before a wallet ever sees it. Nothing is signed here: the payer gets
   * the figure the simulation actually delivers, and confirms against that rather than against the
   * router's own quote.
   */
  const prepareSwap = useCallback(async () => {
    if (!quote) return;
    setError(null);
    setPhase("preparing");
    try {
      const built = await buildSwapTransaction(quote, props.owner.toBase58());
      const transaction = VersionedTransaction.deserialize(
        Uint8Array.from(atob(built.transactionBase64), (c) => c.charCodeAt(0)),
      );
      const check = await verifySwapTransaction({
        connection,
        transaction,
        owner: props.owner,
        quote,
      });
      if (!check.ok) throw new Error(check.reason ?? "this swap did not pass its checks");
      setPrepared({ transaction, expectedOutRaw: check.expectedOutRaw ?? 0n });
      setTwoStepOnly(false);
      setPhase("confirm");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, [quote, props.owner, connection]);

  const signAndSend = useCallback(async () => {
    if (!prepared || !signTransaction) return;
    setError(null);
    setPhase("signing");
    try {
      const signed = await signTransaction(prepared.transaction);
      const sent = await connection.sendRawTransaction(signed.serialize());
      setSignature(sent);
      // The payment below this panel stays blocked until the swap has actually settled: a balance
      // read taken before then still shows the old figure.
      setPhase("landing");
      await waitForSignature(connection, sent);
      setPhase("done");
      props.onSwapped();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("confirm");
    }
  }, [prepared, signTransaction, connection, props]);

  /**
   * Swap and pay as one transaction. The swap half was checked on its own in `prepareSwap`; here the
   * payment's instructions go on the end, the whole thing is simulated together, and only then does
   * the wallet see it. If the two do not fit in one transaction, the offer is withdrawn and the
   * swap-only path stays.
   */
  const swapAndPay = useCallback(async () => {
    if (!prepared || !signTransaction || !checkout) return;
    setError(null);
    setPhase("composing");
    try {
      const payment = await checkout.build();
      const tables = await lookupTablesOf(connection, prepared.transaction);
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const composed = composeSwapAndPayment({
        swap: prepared.transaction,
        lookupTables: tables,
        payment: payment.instructions,
        payer: props.owner,
        blockhash,
      });
      if (!composed.ok) {
        setTwoStepOnly(true);
        setPhase("confirm");
        setError(
          `this route and the payment do not fit in one transaction${composed.bytes ? ` (${composed.bytes} bytes)` : ""} — swap first, then pay`,
        );
        return;
      }
      const check = await verifyComposedCheckout({
        connection,
        transaction: composed.transaction,
        destination: payment.destination,
        native: payment.native,
        rawAmount: checkout.recipientRaw,
      });
      if (!check.ok) throw new Error(check.reason ?? "the combined transaction did not pass its checks");

      setPhase("signing");
      const signed = await signTransaction(composed.transaction);
      const sent = await connection.sendRawTransaction(signed.serialize());
      setSignature(sent);
      setPhase("landing");
      const landed = await signatureOutcome(connection, sent);
      setPhase("done");
      if (landed.err) checkout.onFailed(sent, landed.err);
      else checkout.onPaid(sent);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("confirm");
    }
  }, [prepared, signTransaction, checkout, connection, props.owner]);

  return (
    <section>
      <h2>Short by {groupDigits(rawToUi(props.shortfallRaw, props.targetDecimals))} {props.targetSymbol}</h2>
      <p className="small">
        Swap something else you hold into {props.targetSymbol}. The route comes from the Cookiebox
        and Candy Shop aggregators and is signed by your wallet
        {checkout
          ? "; when the swap covers the payment, both go to your wallet as one transaction."
          : "; the swap is its own transaction."}
      </p>

      {candidates === null && <p className="working">Reading what this wallet holds…</p>}
      {candidates?.length === 0 && (
        <p className="small">This wallet holds nothing else that could be swapped.</p>
      )}

      {candidates && candidates.length > 0 && (
        <>
          <label className="field">
            <span>Swap from</span>
            <select
              value={source ?? ""}
              onChange={(e) => {
                const mint = e.target.value;
                seedingFor.current = mint;
                setSource(mint);
                setQuote(null);
                setPrepared(null);
                setPhase("idle");
                const holding = candidates.find((c) => c.mint === mint);
                if (holding) {
                  void suggestInput(holding).then((amount) => {
                    // The suggestion reads two prices, so it can land long after the payer has moved
                    // on. It applies only while its own token is still the one selected, and it
                    // rewrites the field, so anything quoted or prepared against the old figure goes
                    // with it.
                    if (seedingFor.current !== mint) return;
                    setInputAmount(amount);
                    setQuote(null);
                    setPrepared(null);
                    setPhase("idle");
                  });
                }
              }}
            >
              <option value="" disabled>
                Pick a token
              </option>
              {candidates.map((c) => (
                <option key={c.mint} value={c.mint}>
                  {c.symbol ?? shortAddress(c.mint)} — {groupDigits(rawToUi(c.raw, c.decimals))}
                </option>
              ))}
            </select>
          </label>

          {sourceHolding && (
            <label className="field">
              <span>Amount to swap</span>
              <input
                type="text"
                inputMode="decimal"
                value={inputAmount}
                onChange={(e) => {
                  // A transaction already built and checked is for the amount that was quoted, so it
                  // goes with the quote: Confirm must never still offer the previous figure.
                  setInputAmount(e.target.value);
                  setQuote(null);
                  setPrepared(null);
                  setPhase("idle");
                }}
              />
              <span className="hint">
                Holding {groupDigits(rawToUi(sourceHolding.raw, sourceHolding.decimals))}{" "}
                {sourceHolding.symbol ?? ""}
              </span>
            </label>
          )}

          <div className="buttons">
            <button className="quiet" disabled={!sourceHolding || quoting} onClick={() => void requestQuote()}>
              {quoting ? "Quoting…" : "Get a quote"}
            </button>
            {quote && phase !== "confirm" && (
              <button
                className="quiet"
                disabled={phase !== "idle" || !signTransaction}
                onClick={() => void prepareSwap()}
              >
                {phase === "preparing"
                  ? "Checking the swap…"
                  : phase === "composing"
                    ? "Checking swap and payment together…"
                    : phase === "landing"
                      ? "Landing…"
                      : phase === "signing"
                        ? "Waiting for your wallet…"
                        : phase === "done"
                          ? "Swapped"
                          : "Check this swap"}
              </button>
            )}
            {phase === "confirm" && prepared && coversPayment && checkout && (
              <button className="primary" disabled={!signTransaction} onClick={() => void swapAndPay()}>
                Swap and pay {groupDigits(rawToUi(checkout.rawAmount, props.targetDecimals))}{" "}
                {props.targetSymbol} in one transaction
              </button>
            )}
            {phase === "confirm" && prepared && (
              <button className="quiet" disabled={!signTransaction} onClick={() => void signAndSend()}>
                {coversPayment ? "Swap only: receive " : "Confirm: receive "}
                {groupDigits(rawToUi(prepared.expectedOutRaw, props.targetDecimals))}{" "}
                {props.targetSymbol}
              </button>
            )}
          </div>
        </>
      )}

      {quote && (
        <dl className="rows">
          <div className="row">
            <dt>You receive</dt>
            <dd className="tabular">
              {groupDigits(rawToUi(BigInt(quote.outAmount), props.targetDecimals))}{" "}
              {props.targetSymbol}
            </dd>
          </div>
          <div className="row">
            <dt>At worst</dt>
            <dd className="tabular">
              {groupDigits(rawToUi(BigInt(quote.minOutAmount), props.targetDecimals))}{" "}
              {props.targetSymbol}
            </dd>
          </div>
          <div className="row">
            <dt>Route</dt>
            <dd>{quote.venues.join(" → ") || quote.aggregator}</dd>
          </div>
          <div className="row">
            <dt>Router</dt>
            <dd>{quote.aggregator}</dd>
          </div>
          {quote.priceImpactPct !== null && (
            <div className="row">
              <dt>Price impact</dt>
              <dd className="tabular">{quote.priceImpactPct.toFixed(2)}%</dd>
            </div>
          )}
        </dl>
      )}

      {signature && (
        <p className="small">
          Swapped. <a href={explorerTxUrl(signature)}>{shortAddress(signature, 10, 8)}</a> — the
          balance above refreshes once it settles.
        </p>
      )}
      {error && <p className="alarm">{error}</p>}
    </section>
  );
}

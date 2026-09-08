import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getConnection, waitForSignature } from "../lib/chain";
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
 * The swap step, for a payer who holds the wrong token. Cookie Jar quotes both Cookie Chain
 * aggregators and hands the winning route to the payer's own wallet to sign — the funds never pass
 * through this app, and a swap is a separate transaction from the payment, so a payer can stop after
 * either one.
 */

interface Props {
  owner: PublicKey;
  targetMint: string;
  targetDecimals: number;
  targetSymbol: string;
  /** How much more of the target token the payer needs, in base units. */
  shortfallRaw: bigint;
  onSwapped: () => void;
}

interface Candidate extends Holding {
  priceUsd: number | null;
}

type Phase = "idle" | "preparing" | "confirm" | "signing" | "landing" | "done";

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

  const sourceHolding = candidates?.find((c) => c.mint === source) ?? null;

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

  return (
    <section>
      <h2>Short by {groupDigits(rawToUi(props.shortfallRaw, props.targetDecimals))} {props.targetSymbol}</h2>
      <p className="small">
        Swap something else you hold into {props.targetSymbol} first. The route comes from the
        Cookiebox and Candy Shop aggregators; the swap is its own transaction, signed by your wallet.
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
                setSource(mint);
                setQuote(null);
                const holding = candidates.find((c) => c.mint === mint);
                if (holding) void suggestInput(holding).then(setInputAmount);
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
                  setInputAmount(e.target.value);
                  setQuote(null);
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
                  : phase === "landing"
                    ? "Swap landing…"
                    : phase === "signing"
                      ? "Waiting for your wallet…"
                      : phase === "done"
                        ? "Swapped"
                        : "Check this swap"}
              </button>
            )}
            {phase === "confirm" && prepared && (
              <button className="quiet" disabled={!signTransaction} onClick={() => void signAndSend()}>
                Confirm: receive{" "}
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

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SwapPanel } from "../components/SwapPanel";
import { getConnection } from "../lib/chain";
import {
  BRIDGE_URL,
  COOK_DECIMALS,
  COOK_MINT,
  COOK_SYMBOL,
  FEE_PER_SIGNATURE_COOK,
  explorerAddressUrl,
  explorerTxUrl,
} from "../lib/config";
import { fetchBalanceOf } from "../lib/balances";
import { resolveRecipient } from "../lib/domains";
import { formatUsd, groupDigits, rawToUi, shortAddress, uiToRaw } from "../lib/format";
import { buildPayment, simulatePayment } from "../lib/pay";
import { rawToUsd, usdToRaw } from "../lib/quote";
import {
  buildMemo,
  decodeRequest,
  isOpenAmount,
  jarUrl,
  tokenDecimals,
  tokenSymbol,
  type PaymentRequest,
} from "../lib/request";
import { fetchToken } from "../lib/tokens";

type Stage = "reading" | "ready" | "sending" | "paid";

interface Resolved {
  address: PublicKey;
  name: string | null;
}

export function Pay({ payload }: { payload: string }): JSX.Element {
  const { publicKey, sendTransaction, connected } = useWallet();
  const connection = useMemo(() => getConnection(), []);

  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [enteredAmount, setEnteredAmount] = useState("");
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [stage, setStage] = useState<Stage>("reading");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const decimals = request ? tokenDecimals(request) : COOK_DECIMALS;
  const symbol = request ? tokenSymbol(request) : COOK_SYMBOL;
  const mint = request?.mint ?? COOK_MINT;

  // Read the link, then resolve the name and the price it needs. All three are chain or ecosystem
  // reads, so they run once per link rather than per render.
  useEffect(() => {
    let live = true;
    setError(null);
    setStage("reading");
    (async () => {
      const decoded = decodeRequest(payload);
      if (!live) return;
      setRequest(decoded);

      const recipient = await resolveRecipient(connection, decoded.to);
      if (!live) return;
      setResolved(recipient);

      const token = await fetchToken(decoded.mint ?? "cook").catch(() => null);
      if (!live) return;
      setPriceUsd(token?.priceUsd ?? null);
      setStage("ready");
    })().catch((e: unknown) => {
      if (live) {
        setError(e instanceof Error ? e.message : String(e));
        setStage("ready");
      }
    });
    return () => {
      live = false;
    };
  }, [payload, connection]);

  useEffect(() => {
    if (!publicKey || !request) {
      setBalanceRaw(null);
      return;
    }
    let live = true;
    fetchBalanceOf(connection, publicKey, request.mint)
      .then((holding) => {
        if (live) setBalanceRaw(holding.raw);
      })
      .catch(() => {
        if (live) setBalanceRaw(null);
      });
    return () => {
      live = false;
    };
  }, [publicKey, request, connection, stage]);

  /** The amount this payment will actually move, in base units. */
  const rawAmount = useMemo((): bigint | null => {
    if (!request) return null;
    try {
      if (request.amount) return uiToRaw(request.amount, decimals);
      if (request.usd && priceUsd) return usdToRaw(request.usd, priceUsd, decimals);
      if (isOpenAmount(request) && enteredAmount.trim()) return uiToRaw(enteredAmount, decimals);
    } catch {
      return null;
    }
    return null;
  }, [request, decimals, priceUsd, enteredAmount]);

  const shortfall = useMemo(() => {
    if (rawAmount === null || balanceRaw === null) return null;
    return balanceRaw < rawAmount ? rawAmount - balanceRaw : null;
  }, [rawAmount, balanceRaw]);

  const pay = useCallback(async () => {
    if (!request || !resolved || !publicKey || rawAmount === null) return;
    setError(null);
    setWarning(null);
    setStage("sending");
    try {
      const built = await buildPayment({
        connection,
        payer: publicKey,
        recipient: resolved.address,
        rawAmount,
        mint: request.mint,
        decimals,
        memo: buildMemo(request),
      });

      const outcome = await simulatePayment(connection, built.transaction);
      if (!outcome.ok) throw new Error(outcome.message ?? "the payment did not simulate");

      const sent = await sendTransaction(built.transaction, connection);
      const confirmation = await connection.confirmTransaction(
        {
          signature: sent,
          blockhash: built.blockhash,
          lastValidBlockHeight: built.lastValidBlockHeight,
        },
        "confirmed",
      );
      setSignature(sent);
      if (confirmation.value.err) {
        setWarning(
          "the network accepted the transaction but reported an error confirming it — check the explorer",
        );
      }
      setStage("paid");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("ready");
    }
  }, [request, resolved, publicKey, rawAmount, connection, decimals, sendTransaction]);

  if (stage === "reading" && !request) {
    return <p className="working">Reading the payment link…</p>;
  }

  if (!request) {
    return (
      <>
        <h1>This link cannot be read</h1>
        {error && <p className="alarm">{error}</p>}
        <p>
          <a href="#/">Make a new payment link</a>
        </p>
      </>
    );
  }

  const usdValue = rawAmount !== null && priceUsd ? rawToUsd(rawAmount, priceUsd, decimals) : null;

  if (stage === "paid" && signature) {
    return (
      <>
        <p className="stamp">Paid</p>
        <h1>{request.label ?? "Payment sent"}</h1>
        <div className="amount">
          <span>{groupDigits(rawToUi(rawAmount ?? 0n, decimals))}</span>
          <span className="unit">{symbol}</span>
        </div>
        {usdValue !== null && <p className="usd">{formatUsd(usdValue)} at the time of payment</p>}
        <hr className="perf" />
        <dl className="rows">
          <div className="row">
            <dt>To</dt>
            <dd className="mono">{request.to}</dd>
          </div>
          {request.note && (
            <div className="row">
              <dt>For</dt>
              <dd>{request.note}</dd>
            </div>
          )}
          {request.ref && (
            <div className="row">
              <dt>Reference</dt>
              <dd className="mono">{request.ref}</dd>
            </div>
          )}
          <div className="row">
            <dt>Signature</dt>
            <dd className="mono">
              <a href={explorerTxUrl(signature)}>{shortAddress(signature, 10, 8)}</a>
            </dd>
          </div>
        </dl>
        {warning && <p className="alarm">{warning}</p>}
        <p className="small">
          The memo on this transaction is what puts it in the jar's history. Anyone can read it back
          from the chain, with or without this app.
        </p>
        <div className="buttons">
          <a className="quiet" href={jarUrl(request.to, "")} style={{ textDecoration: "none" }}>
            <button className="quiet">See the jar</button>
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>{request.label ?? "Payment request"}</h1>
      {request.note && <p className="lede">{request.note}</p>}

      {isOpenAmount(request) ? (
        <label className="field">
          <span>Amount in {symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={enteredAmount}
            onChange={(e) => setEnteredAmount(e.target.value)}
            placeholder="0"
            autoFocus
          />
          {usdValue !== null && <span className="hint">{formatUsd(usdValue)}</span>}
        </label>
      ) : (
        <>
          <div className="amount">
            <span>
              {rawAmount === null ? "…" : groupDigits(rawToUi(rawAmount, decimals))}
            </span>
            <span className="unit">{symbol}</span>
          </div>
          <p className="usd">
            {request.usd
              ? `${formatUsd(Number(request.usd))} at ${priceUsd ? `$${priceUsd.toPrecision(4)}` : "the current price"} per ${symbol}`
              : usdValue !== null
                ? formatUsd(usdValue)
                : ""}
          </p>
        </>
      )}

      <hr className="perf" />

      <dl className="rows">
        <div className="row">
          <dt>To</dt>
          <dd className="mono">
            {resolved ? (
              <a href={explorerAddressUrl(resolved.address.toBase58())}>
                {resolved.name ?? shortAddress(resolved.address.toBase58(), 8, 6)}
              </a>
            ) : (
              "resolving…"
            )}
          </dd>
        </div>
        {resolved?.name && (
          <div className="row">
            <dt>Address</dt>
            <dd className="mono">{shortAddress(resolved.address.toBase58(), 8, 6)}</dd>
          </div>
        )}
        <div className="row">
          <dt>Token</dt>
          <dd className="mono">{mint === COOK_MINT ? `${COOK_SYMBOL} (native)` : shortAddress(mint, 8, 6)}</dd>
        </div>
        {request.ref && (
          <div className="row">
            <dt>Reference</dt>
            <dd className="mono">{request.ref}</dd>
          </div>
        )}
        <div className="row">
          <dt>Network fee</dt>
          <dd className="tabular">
            {FEE_PER_SIGNATURE_COOK} {COOK_SYMBOL}
          </dd>
        </div>
        {balanceRaw !== null && (
          <div className="row">
            <dt>You hold</dt>
            <dd className="tabular">
              {groupDigits(rawToUi(balanceRaw, decimals))} {symbol}
            </dd>
          </div>
        )}
      </dl>

      {error && <p className="alarm">{error}</p>}

      {!connected && (
        <p className="small">Connect a wallet to pay. Nightly is Cookie Chain's own wallet.</p>
      )}

      <p>
        <button
          className="primary"
          disabled={!connected || rawAmount === null || stage === "sending" || shortfall !== null}
          onClick={() => void pay()}
        >
          {stage === "sending"
            ? "Waiting for your wallet…"
            : rawAmount === null
              ? "Enter an amount"
              : `Pay ${groupDigits(rawToUi(rawAmount, decimals))} ${symbol}`}
        </button>
      </p>

      {shortfall !== null && rawAmount !== null && publicKey && (
        <SwapPanel
          owner={publicKey}
          targetMint={mint}
          targetDecimals={decimals}
          targetSymbol={symbol}
          shortfallRaw={shortfall}
          onSwapped={() => setStage((s) => (s === "ready" ? "ready" : s))}
        />
      )}

      {balanceRaw === 0n && mint === COOK_MINT && (
        <p className="small">
          This wallet holds no {COOK_SYMBOL}. Bring some across from Solana at the Cookie Chain
          bridge:
          <br />
          <a href={BRIDGE_URL}>{BRIDGE_URL}</a>
        </p>
      )}

      <p className="small">
        Cookie Jar never holds the money. This page builds one transaction, your wallet signs it, and
        the funds go straight to the address above.
      </p>
    </>
  );
}

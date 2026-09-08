import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SwapPanel } from "../components/SwapPanel";
import { WalletPicker } from "../components/WalletPicker";
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
import { fetchBalanceOf, type Holding } from "../lib/balances";
import { resolveRecipient } from "../lib/domains";
import {
  displayAmount,
  formatUsd,
  groupDigits,
  isRounded,
  rawToUi,
  shortAddress,
  uiToRaw,
} from "../lib/format";
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
  const { publicKey, sendTransaction, connected, disconnect } = useWallet();
  const connection = useMemo(() => getConnection(), []);
  const origin = useMemo(
    () => window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
    [],
  );

  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [enteredAmount, setEnteredAmount] = useState("");
  const [holding, setHolding] = useState<Holding | null>(null);
  const [stage, setStage] = useState<Stage>("reading");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  /** Bumped after a swap so the balance below the amount is re-read. */
  const [balanceEpoch, setBalanceEpoch] = useState(0);
  const [picking, setPicking] = useState(false);

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
      setHolding(null);
      return;
    }
    let live = true;
    fetchBalanceOf(connection, publicKey, request.mint)
      .then((result) => {
        if (live) setHolding(result);
      })
      .catch(() => {
        if (live) setHolding(null);
      });
    return () => {
      live = false;
    };
  }, [publicKey, request, connection, stage, balanceEpoch]);

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
    if (rawAmount === null || holding === null) return null;
    return holding.spendable < rawAmount ? rawAmount - holding.spendable : null;
  }, [rawAmount, holding]);

  /**
   * Why this payment cannot go, in the words the button wears. A recipient that failed to resolve
   * blocks it before the wallet is even considered: an unregistered name and a name sitting in the
   * marketplace escrow both reach this state, and neither has an address worth paying.
   */
  const payBlocker = useMemo((): string | null => {
    if (!resolved) return "This link's recipient does not resolve";
    if (stage === "sending") return "Waiting for your wallet…";
    if (rawAmount === null) return "Enter an amount";
    if (connected && shortfall !== null) return `You need more ${symbol} than this wallet holds`;
    return null;
  }, [resolved, connected, stage, rawAmount, shortfall, symbol]);

  const pay = useCallback(async () => {
    if (!request || !resolved || !publicKey || rawAmount === null) return;
    setError(null);
    setWarning(null);
    setStage("sending");
    try {
      // The address was resolved when the page opened. A `.cook` name can be transferred or listed
      // for sale in between, and this page can sit open for a long time, so the recipient is read
      // again here and the payment is refused rather than sent somewhere else.
      const current = await resolveRecipient(connection, request.to);
      if (!current.address.equals(resolved.address)) {
        setResolved(current);
        throw new Error(
          "the recipient changed while this page was open — reload and check the address before paying",
        );
      }

      const built = await buildPayment({
        connection,
        payer: publicKey,
        recipient: current.address,
        rawAmount,
        mint: request.mint,
        decimals,
        memo: buildMemo(request),
      });

      const outcome = await simulatePayment(connection, built.transaction);
      if (!outcome.ok) throw new Error(outcome.message ?? "the payment did not simulate");

      // A blockhash expires in about a minute and the wallet prompt can sit longer than that, so the
      // one the payer signs is fetched after simulation rather than before it.
      const fresh = await connection.getLatestBlockhash("confirmed");
      built.transaction.recentBlockhash = fresh.blockhash;

      const sent = await sendTransaction(built.transaction, connection);
      const confirmation = await connection.confirmTransaction(
        {
          signature: sent,
          blockhash: fresh.blockhash,
          lastValidBlockHeight: fresh.lastValidBlockHeight,
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
          <span>{displayAmount(rawAmount ?? 0n, decimals)}</span>
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
        <p>
          <a href={jarUrl(request.to, origin)}>See this jar's history</a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{request.label ?? "Payment request"}</h1>
      {request.note && <p className="lede">{request.note}</p>}

      {isOpenAmount(request) ? (
        <label className="field">
          <span>Amount</span>
          <div className="with-unit">
            <input
              type="text"
              inputMode="decimal"
              value={enteredAmount}
              onChange={(e) => setEnteredAmount(e.target.value)}
              placeholder="any amount"
            />
            <span className="unit">{symbol}</span>
          </div>
          {usdValue !== null && <span className="hint">{formatUsd(usdValue)}</span>}
        </label>
      ) : (
        <>
          <div className="amount">
            <span>{rawAmount === null ? "…" : displayAmount(rawAmount, decimals)}</span>
            <span className="unit">{symbol}</span>
          </div>
          <p className="usd">
            {request.usd
              ? `${formatUsd(Number(request.usd))} at ${priceUsd ? `$${priceUsd.toPrecision(4)}` : "the current price"} per ${symbol}`
              : usdValue !== null
                ? formatUsd(usdValue)
                : ""}
            {rawAmount !== null && isRounded(rawAmount, decimals)
              ? ` · exactly ${groupDigits(rawToUi(rawAmount, decimals))} ${symbol}`
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
            ) : error ? (
              request.to
            ) : (
              "resolving…"
            )}
          </dd>
        </div>
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
        {holding !== null && (
          <div className="row">
            <dt>You can send</dt>
            <dd className="tabular">
              {displayAmount(holding.spendable, decimals)} {symbol}
              {holding.accountCount > 1 && holding.spendable < holding.raw
                ? ` of ${displayAmount(holding.raw, decimals)} across ${holding.accountCount} accounts`
                : ""}
            </dd>
          </div>
        )}
      </dl>

      {error && <p className="alarm">{error}</p>}

      <p>
        <button
          className="primary"
          disabled={payBlocker !== null}
          onClick={() => (connected ? void pay() : setPicking(true))}
        >
          {payBlocker ??
            (connected
              ? `Pay ${displayAmount(rawAmount ?? 0n, decimals)} ${symbol}`
              : "Connect a wallet to pay")}
        </button>
      </p>

      {picking && !connected && <WalletPicker onPicked={() => setPicking(false)} />}

      {connected && publicKey && (
        <p className="small">
          Paying from <span className="mono">{shortAddress(publicKey.toBase58())}</span> ·{" "}
          <button className="link" onClick={() => void disconnect()}>
            use another wallet
          </button>
        </p>
      )}

      {shortfall !== null && rawAmount !== null && publicKey && (
        <SwapPanel
          owner={publicKey}
          targetMint={mint}
          targetDecimals={decimals}
          targetSymbol={symbol}
          shortfallRaw={shortfall}
          onSwapped={() => setBalanceEpoch((e) => e + 1)}
        />
      )}

      {holding?.raw === 0n && mint === COOK_MINT && (
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

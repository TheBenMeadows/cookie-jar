import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getConnection } from "../lib/chain";
import { resolveRecipient } from "../lib/domains";
import {
  fetchJarHistory,
  SCAN_CAP,
  totalsByToken,
  type JarPayment,
  type JarTotal,
} from "../lib/history";
import { fetchToken } from "../lib/tokens";
import { explorerAddressUrl, explorerTxUrl, COOK_MINT, COOK_SYMBOL } from "../lib/config";
import { formatTimestamp, groupDigits, rawToUi, shortAddress } from "../lib/format";
import { coversAbsence, paymentsForRef } from "../lib/reconcile";
import { jarUrl, receiptUrl } from "../lib/request";
import { fetchTxDetail, type TxDetail } from "../lib/txdetail";
import { Qr } from "../components/Qr";
import { TxShape } from "../components/TxShape";

/** How many of a reference's payments have their transaction shape read. A receipt rarely has more than one. */
const DETAILED_PAYMENTS = 5;

interface ResolvedRecipient {
  address: PublicKey;
  name: string | null;
}

/**
 * Public jar history page.
 * Resolves recipient name or address, fetches on-chain payment history, displays total receipts,
 * and renders individual memo-tagged payments. With `refFilter` set the page answers one question
 * first — was the request carrying that reference paid — from the same chain data.
 */
export function Jar({
  recipient,
  refFilter = null,
}: {
  recipient: string;
  refFilter?: string | null;
}): JSX.Element {
  const connection = useMemo(() => getConnection(), []);
  const [resolved, setResolved] = useState<ResolvedRecipient | null>(null);
  const [payments, setPayments] = useState<JarPayment[] | null>(null);
  const [hitCap, setHitCap] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [stoppedAtLimit, setStoppedAtLimit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const [resolvedSymbols, setResolvedSymbols] = useState<Record<string, string>>({});
  /** The shape of each matching payment's transaction, by signature. Null when the RPC no longer holds it. */
  const [details, setDetails] = useState<Record<string, TxDetail | null>>({});

  const origin = useMemo(
    () => window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
    [],
  );

  // Resolve recipient and fetch up to 50 payments
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setResolved(null);
    setPayments(null);

    (async () => {
      const res = await resolveRecipient(connection, recipient);
      if (!live) return;
      setResolved(res);

      const history = await fetchJarHistory(connection, res.address, 50);
      if (!live) return;
      setPayments(history.payments);
      setScanned(history.scanned);
      setHitCap(history.hitCap);
      setStoppedAtLimit(history.stoppedAtLimit);
      setLoading(false);
    })().catch((e: unknown) => {
      if (live) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    });

    return () => {
      live = false;
    };
  }, [connection, recipient, reloadCount]);

  // Compute totals by token
  const totals = useMemo((): JarTotal[] => {
    return payments ? totalsByToken(payments) : [];
  }, [payments]);

  // Look up missing token symbols for totals and payments
  useEffect(() => {
    if (!payments) return;
    let live = true;
    const missingMints = new Set<string>();

    for (const t of totals) {
      if (!t.symbol && !resolvedSymbols[t.mint] && t.mint !== COOK_MINT) {
        missingMints.add(t.mint);
      }
    }
    for (const p of payments) {
      if (!p.symbol && !resolvedSymbols[p.mint] && p.mint !== COOK_MINT) {
        missingMints.add(p.mint);
      }
    }

    if (missingMints.size === 0) return;

    Promise.all(
      Array.from(missingMints).map(async (mint) => {
        try {
          const info = await fetchToken(mint);
          return { mint, symbol: info?.symbol ?? shortAddress(mint) };
        } catch {
          return { mint, symbol: shortAddress(mint) };
        }
      }),
    ).then((results) => {
      if (!live) return;
      setResolvedSymbols((prev) => {
        const next = { ...prev };
        for (const item of results) {
          next[item.mint] = item.symbol;
        }
        return next;
      });
    });

    return () => {
      live = false;
    };
  }, [totals, payments, resolvedSymbols]);

  // On a receipt, each matching payment's transaction is read once more, this time for its shape:
  // a composed checkout shows as many instructions behind one signature, which the amount row alone
  // cannot say. Signatures are deduplicated because a payment in two assets lists twice.
  useEffect(() => {
    if (!payments || !refFilter) return;
    const signatures = [...new Set(paymentsForRef(payments, refFilter).map((p) => p.signature))].slice(
      0,
      DETAILED_PAYMENTS,
    );
    if (signatures.length === 0) return;
    let live = true;
    Promise.all(
      signatures.map(async (signature) => {
        const detail = await fetchTxDetail(connection, signature).catch(() => null);
        return [signature, detail] as const;
      }),
    ).then((entries) => {
      if (live) setDetails(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [connection, payments, refFilter]);

  const handleCopyAddress = useCallback(() => {
    if (!resolved) return;
    void navigator.clipboard.writeText(resolved.address.toBase58()).then(() => {
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    });
  }, [resolved]);

  const handleCopyShareUrl = useCallback(() => {
    const shareUrl = jarUrl(recipient, origin);
    void navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [recipient, origin]);

  if (error && !resolved) {
    return (
      <>
        <h1>No jar here</h1>
        <p className="alarm">{error}</p>
        <p>
          <a href="#/">Make a payment link</a>
        </p>
      </>
    );
  }

  if (loading) {
    return <p className="working">Reading this jar from the chain…</p>;
  }

  if (!resolved || !payments) {
    return (
      <>
        <h1>This jar did not load</h1>
        <p className="alarm">{error ?? "the chain answered with nothing"}</p>
        <div className="buttons">
          <button type="button" className="quiet" onClick={() => setReloadCount((c) => c + 1)}>
            Try again
          </button>
        </div>
      </>
    );
  }

  const addressBase58 = resolved.address.toBase58();
  const headerTitle = resolved.name ?? shortAddress(addressBase58, 8, 6);
  const shareUrl = jarUrl(recipient, origin);

  const getSymbol = (mint: string, symbol: string): string => {
    if (symbol) return symbol;
    if (mint === COOK_MINT) return COOK_SYMBOL;
    return resolvedSymbols[mint] ?? shortAddress(mint);
  };

  const totalPaymentsCount = payments.length;
  const totalTokensCount = totals.length;
  const matching = refFilter ? paymentsForRef(payments, refFilter) : [];
  /** Whether an absence of matching payments is evidence, or just the edge of what was read. */
  const readToTheEnd = coversAbsence({ scanned, hitCap, stoppedAtLimit });
  const matchingTotals = refFilter ? totalsByToken(matching) : [];

  return (
    <>
      <h1>{headerTitle}</h1>
      <p className="small buttons">
        <a className="mono" href={explorerAddressUrl(addressBase58)} title={addressBase58}>
          {shortAddress(addressBase58, 8, 6)}
        </a>
        <button className="quiet" type="button" onClick={handleCopyAddress}>
          {addressCopied ? "Copied" : "Copy the full key"}
        </button>
      </p>

      {refFilter && (
        <>
          <p className={matching.length > 0 ? "stamp" : "stamp stopped"}>
            {matching.length > 0 ? "Paid" : readToTheEnd ? "Not paid" : "No record"}
          </p>
          <h2>
            Reference <span className="mono">{refFilter}</span>
          </h2>
          {matching.length > 0 ? (
            <>
              {matchingTotals.map((t) => (
                <div className="amount" key={t.mint}>
                  <span>{groupDigits(rawToUi(t.raw, t.decimals))}</span>
                  <span className="unit">{getSymbol(t.mint, t.symbol)}</span>
                </div>
              ))}
              <p className="small">
                {matching.length === 1
                  ? "One payment carrying this reference reached this jar."
                  : `${matching.length} payments carrying this reference reached this jar.`}{" "}
                A reference is text anyone can put in a memo; the transaction link is the evidence.
              </p>
              <div className="rows stacked">
                {matching.map((p) => (
                  <div className="row" key={`ref:${p.signature}:${p.mint}`}>
                    <div className="k">
                      <div>{formatTimestamp(p.blockTime)}</div>
                      {p.note && <div>{p.note}</div>}
                    </div>
                    <div className="v">
                      <div>
                        {groupDigits(rawToUi(p.rawAmount, p.decimals))} {getSymbol(p.mint, p.symbol)}
                      </div>
                      {p.from && <div>From: {shortAddress(p.from)}</div>}
                      {details[p.signature] && (
                        <div>
                          <TxShape detail={details[p.signature] as TxDetail} />
                        </div>
                      )}
                      <div>
                        <a href={explorerTxUrl(p.signature)} className="mono">
                          {shortAddress(p.signature, 8, 6)}
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="small">
              {readToTheEnd
                ? "No payment carrying this reference has reached this jar in everything this RPC holds for it."
                : "No payment carrying this reference is in the part of this jar's history that could be read, so this is not an answer either way. A public Cookie Chain node keeps roughly the last ten days; a payment older than that is on chain and settled, and simply cannot be seen from here."}
            </p>
          )}
          <div className="linkbox">
            <input type="text" readOnly value={receiptUrl(recipient, refFilter, origin)} />
            <button
              type="button"
              className="quiet"
              onClick={() => void navigator.clipboard.writeText(receiptUrl(recipient, refFilter, origin))}
            >
              Copy
            </button>
          </div>
          <p className="small">
            <a href={jarUrl(recipient, origin)}>Every payment into this jar</a>
          </p>
          <hr className="perf" />
        </>
      )}

      {totals.map((t) => (
        <div className="amount" key={t.mint}>
          <span>{groupDigits(rawToUi(t.raw, t.decimals))}</span>
          <span className="unit">{getSymbol(t.mint, t.symbol)}</span>
        </div>
      ))}

      {payments.length > 0 ? (
        <>
          <p className="small">
            {totalPaymentsCount} {totalPaymentsCount === 1 ? "payment" : "payments"} across{" "}
            {totalTokensCount} {totalTokensCount === 1 ? "token" : "tokens"}.
            {stoppedAtLimit
              ? ` Showing the latest ${totalPaymentsCount}; older transactions on this jar were not read.`
              : ""}
            {hitCap
              ? ` Only the most recent ${SCAN_CAP} transactions on this jar's addresses were read, so older payments are not listed.`
              : ""}
          </p>

          <hr className="perf" />

          <div className="rows stacked">
            {payments.map((p) => (
              <div className="row" key={`${p.signature}:${p.mint}`}>
                <div className="k">
                  <div>{formatTimestamp(p.blockTime)}</div>
                  {p.note && <div>{p.note}</div>}
                </div>
                <div className="v">
                  <div>
                    {groupDigits(rawToUi(p.rawAmount, p.decimals))} {getSymbol(p.mint, p.symbol)}
                  </div>
                  {p.from && <div>From: {shortAddress(p.from)}</div>}
                  {p.ref && <div>Ref: {p.ref}</div>}
                  <div>
                    <a href={explorerTxUrl(p.signature)} className="mono">
                      {shortAddress(p.signature, 8, 6)}
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p>
            No Cookie Tab payments were found in the transactions this RPC still holds for this address.
            A transfer to this address without a Cookie Tab memo is not shown here. A public Cookie Chain
            node keeps roughly the last ten days; older payments are on chain but not in its index.
          </p>
          <p>
            <a href="#/">Make a payment link for this address</a>
          </p>
        </>
      )}

      <hr className="perf" />

      <h2>Share this jar</h2>
      <div className="linkbox">
        <input type="text" readOnly value={shareUrl} />
        <button type="button" className="quiet" onClick={handleCopyShareUrl}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <Qr value={shareUrl} alt="QR code for this jar" />

    </>
  );
}

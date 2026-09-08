import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getConnection } from "../lib/chain";
import { resolveRecipient } from "../lib/domains";
import { fetchJarHistory, totalsByToken, type JarPayment, type JarTotal } from "../lib/history";
import { fetchToken } from "../lib/tokens";
import { explorerAddressUrl, explorerTxUrl, COOK_MINT, COOK_SYMBOL } from "../lib/config";
import { formatTimestamp, groupDigits, rawToUi, shortAddress } from "../lib/format";
import { jarUrl } from "../lib/request";
import { Qr } from "../components/Qr";

interface ResolvedRecipient {
  address: PublicKey;
  name: string | null;
}

/**
 * Public jar history page.
 * Resolves recipient name or address, fetches on-chain payment history, displays total receipts,
 * and renders individual memo-tagged payments.
 */
export function Jar({ recipient }: { recipient: string }): JSX.Element {
  const connection = useMemo(() => getConnection(), []);
  const [resolved, setResolved] = useState<ResolvedRecipient | null>(null);
  const [payments, setPayments] = useState<JarPayment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const [resolvedSymbols, setResolvedSymbols] = useState<Record<string, string>>({});

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
      setPayments(history);
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

  return (
    <>
      <h1>{headerTitle}</h1>
      <p className="small">
        <a className="mono" href={explorerAddressUrl(addressBase58)}>
          {shortAddress(addressBase58, 8, 6)}
        </a>{" "}
        <button className="link" type="button" onClick={handleCopyAddress}>
          {addressCopied ? "copied" : "copy the full key"}
        </button>
      </p>

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
          </p>

          <hr className="perf" />

          <div className="rows">
            {payments.map((p) => (
              <div className="row" key={p.signature}>
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
            No Cookie Jar payments have reached this address yet. A transfer to this address without
            a Cookie Jar memo is not shown here.
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

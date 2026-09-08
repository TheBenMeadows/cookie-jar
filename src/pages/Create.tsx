import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getConnection } from "../lib/chain";
import { fetchPrimaryName } from "../lib/domains";
import { payUrl, jarUrl, RequestError, type PaymentRequest } from "../lib/request";
import { searchTokens, fetchNativeToken, COOK_TOKEN, type TokenInfo } from "../lib/tokens";
import { Qr } from "../components/Qr";
import { groupDigits, shortAddress } from "../lib/format";
import { COOK_MINT } from "../lib/config";

type PricingMode = "fixed" | "usd" | "open";

/**
 * Form component to generate payment links and QR codes.
 * Supports token payments, USD equivalent pricing, or open tip jar requests.
 */
export function Create(): JSX.Element {
  const { publicKey, connected } = useWallet();
  const connection = useMemo(() => getConnection(), []);

  const [recipient, setRecipient] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [pricingMode, setPricingMode] = useState<PricingMode>("fixed");
  const [amountVal, setAmountVal] = useState("");
  const [usdVal, setUsdVal] = useState("");
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(COOK_TOKEN);
  const [nativeToken, setNativeToken] = useState<TokenInfo>(COOK_TOKEN);

  const [tokenQuery, setTokenQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TokenInfo[]>([]);
  const [hasPrefilled, setHasPrefilled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // Origin computed once for URLs
  const origin = useMemo(
    () => window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
    [],
  );

  // COOK's price decides whether a request can be quoted in dollars. It has to be read: the
  // constant the form starts from carries no price, and treating that as "Cookiescan has no price"
  // would disable the dollar option on a chain whose gas token is priced.
  useEffect(() => {
    let live = true;
    fetchNativeToken()
      .then((token) => {
        if (!live) return;
        setNativeToken(token);
        setSelectedToken((current) => (current.mint === COOK_MINT ? token : current));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Auto-prefill recipient when wallet connects if recipient field is empty
  useEffect(() => {
    if (!connected || !publicKey || hasPrefilled) return;
    let live = true;
    fetchPrimaryName(connection, publicKey)
      .then((name) => {
        if (!live) return;
        setRecipient((current) => {
          if (current.trim() === "") {
            return name ?? publicKey.toBase58();
          }
          return current;
        });
        setHasPrefilled(true);
      })
      .catch(() => {
        if (!live) return;
        setRecipient((current) => {
          if (current.trim() === "") {
            return publicKey.toBase58();
          }
          return current;
        });
        setHasPrefilled(true);
      });
    return () => {
      live = false;
    };
  }, [connected, publicKey, connection, hasPrefilled]);

  // Debounced token search
  useEffect(() => {
    let live = true;
    if (!tokenQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      searchTokens(tokenQuery)
        .then((tokens) => {
          if (live) setSearchResults(tokens);
        })
        .catch(() => {
          if (live) setSearchResults([]);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tokenQuery]);

  // Offer COOK first, followed by filtered search results
  const availableTokens = useMemo(() => {
    const listWithoutCook = searchResults.filter((t) => t.mint !== COOK_MINT);
    return [nativeToken, ...listWithoutCook];
  }, [searchResults, nativeToken]);

  const handleSelectToken = useCallback((token: TokenInfo) => {
    setSelectedToken(token);
    if (token.priceUsd === null) {
      setPricingMode((prev) => (prev === "usd" ? "fixed" : prev));
    }
  }, []);

  // Compute PaymentRequest and URL via useMemo using encodeRequest
  const { payLinkUrl, requestError } = useMemo<{
    payLinkUrl: string | null;
    requestError: string | null;
  }>(() => {
    if (!recipient.trim()) {
      return { payLinkUrl: null, requestError: null };
    }
    try {
      const req: PaymentRequest = {
        to: recipient.trim(),
      };
      if (label.trim()) req.label = label.trim();
      if (note.trim()) req.note = note.trim();
      if (ref.trim()) req.ref = ref.trim();

      if (selectedToken.mint !== COOK_MINT) {
        req.mint = selectedToken.mint;
        req.decimals = selectedToken.decimals;
        req.symbol = selectedToken.symbol;
      }

      if (pricingMode === "fixed" && amountVal.trim()) {
        req.amount = amountVal.trim();
      } else if (pricingMode === "usd" && usdVal.trim()) {
        req.usd = usdVal.trim();
      }

      return { payLinkUrl: payUrl(req, origin), requestError: null };
    } catch (e: unknown) {
      const message =
        e instanceof RequestError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      return { payLinkUrl: null, requestError: message };
    }
  }, [
    recipient,
    label,
    note,
    ref,
    selectedToken,
    pricingMode,
    amountVal,
    usdVal,
    origin,
  ]);

  /**
   * Why the link cannot be made yet, in the words the button wears. A mode with an empty amount is
   * blocked rather than encoded: "a fixed amount of COOK" with the amount left blank would otherwise
   * silently produce an open tip jar, which is a different request from the one that was asked for.
   */
  const blockedReason = useMemo((): string | null => {
    if (!recipient.trim()) return "Enter a recipient to make the link";
    if (requestError) return requestError;
    if (pricingMode === "fixed" && !amountVal.trim()) return `Enter an amount in ${selectedToken.symbol}`;
    if (pricingMode === "usd" && !usdVal.trim()) return "Enter an amount in US dollars";
    if (!payLinkUrl) return "Fill in the form to make the link";
    return null;
  }, [recipient, requestError, pricingMode, amountVal, usdVal, selectedToken.symbol, payLinkUrl]);

  const handleCopy = useCallback(() => {
    if (!payLinkUrl) return;
    navigator.clipboard
      .writeText(payLinkUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopyFailed(true));
  }, [payLinkUrl]);

  return (
    <>
      <h1>Make a payment link</h1>
      <p className="lede">
        Whoever opens the link pays you on Cookie Chain. Nothing is stored on a server: the request
        is carried inside the link itself.
      </p>

      <div className="split">
        <div>
      <label className="field">
        <span>Recipient</span>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="baker.cook or a Cookie Chain address"
        />
      </label>

      <div className="field">
        <span>Token</span>
        <input
          type="search"
          value={tokenQuery}
          onChange={(e) => setTokenQuery(e.target.value)}
          placeholder="Leave empty to be paid in COOK"
        />
        {tokenQuery.trim() !== "" && (
          <ul className="results">
            {availableTokens.map((t) => (
              <li key={t.mint}>
                <button
                  type="button"
                  aria-pressed={t.mint === selectedToken.mint}
                  onClick={() => handleSelectToken(t)}
                >
                  <span className="ticker">{t.symbol}</span>
                  <span>{t.name}</span>
                  <span className="addr">
                    {t.mint === COOK_MINT ? "native" : shortAddress(t.mint)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="hint">
          Paying in {selectedToken.symbol}
          {selectedToken.mint === COOK_MINT ? "" : ` (${selectedToken.decimals} decimals)`}.
        </span>
      </div>

      <div className="field">
        <span>Amount</span>
        <ul className="choices">
          <li>
            <label>
              <input
                type="radio"
                name="pricingMode"
                value="fixed"
                checked={pricingMode === "fixed"}
                onChange={() => setPricingMode("fixed")}
              />
              A fixed amount of {selectedToken.symbol}
            </label>
          </li>
          <li>
            <label>
              <input
                type="radio"
                name="pricingMode"
                value="usd"
                checked={pricingMode === "usd"}
                disabled={selectedToken.priceUsd === null}
                onChange={() => setPricingMode("usd")}
              />
              A fixed amount in US dollars
            </label>
          </li>
          <li>
            <label>
              <input
                type="radio"
                name="pricingMode"
                value="open"
                checked={pricingMode === "open"}
                onChange={() => setPricingMode("open")}
              />
              Whatever the payer chooses, for a tip jar
            </label>
          </li>
        </ul>
        {selectedToken.priceUsd === null && (
          <span className="hint">
            Cookiescan has no price for {selectedToken.symbol}, so a dollar amount cannot be quoted.
          </span>
        )}
      </div>

      {pricingMode === "fixed" && (
        <label className="field">
          <span>Amount in {selectedToken.symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountVal}
            onChange={(e) => setAmountVal(e.target.value)}
            placeholder="25000"
          />
        </label>
      )}

      {pricingMode === "usd" && (
        <label className="field">
          <span>Amount in US dollars</span>
          <input
            type="text"
            inputMode="decimal"
            value={usdVal}
            onChange={(e) => setUsdVal(e.target.value)}
            placeholder="25.00"
          />
          <span className="hint">
            Converted to {selectedToken.symbol} when the payer opens the link, at the Cookiescan
            price of the moment.
          </span>
        </label>
      )}

      <details className="more">
        <summary>Label, note and reference</summary>
        <label className="field">
          <span>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Baker's Dozen"
          />
          <span className="hint">The heading the payer sees.</span>
        </label>

        <label className="field">
          <span>Note</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Order #1042, 12 sourdough loaves"
          />
          <span className="hint">Goes on chain in the memo, so it is public.</span>
        </label>

        <label className="field">
          <span>Reference</span>
          <input
            type="text"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="INV-2026-001"
          />
          <span className="hint">Your own invoice number. Also goes in the memo.</span>
        </label>
      </details>

      {requestError && <p className="alarm">{requestError}</p>}

      <p>
        <button
          type="button"
          className="primary"
          disabled={blockedReason !== null}
          onClick={handleCopy}
        >
          {blockedReason ?? (copied ? "Copied" : "Copy payment link")}
        </button>
      </p>
        </div>

        <div className="output">
      {payLinkUrl && !blockedReason ? (
        <>
          <hr className="perf" />
          <div className="linkbox">
            <input type="text" readOnly value={payLinkUrl} />
            <button type="button" className="quiet" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {copyFailed && (
            <p className="alarm">
              This browser refused the clipboard. Select the link above and copy it by hand.
            </p>
          )}

          <Qr value={payLinkUrl} alt="QR code for this payment link" />

          <dl className="rows">
            <div className="row">
              <dt>Recipient</dt>
              <dd className="mono">{recipient}</dd>
            </div>
            <div className="row">
              <dt>Amount</dt>
              <dd>
                {pricingMode === "fixed"
                  ? `${groupDigits(amountVal || "0")} ${selectedToken.symbol}`
                  : pricingMode === "usd"
                    ? `$${usdVal || "0"}`
                    : "Whatever the payer chooses"}
              </dd>
            </div>
            <div className="row">
              <dt>Token</dt>
              <dd className="mono">{selectedToken.symbol}</dd>
            </div>
            {ref.trim() && (
              <div className="row">
                <dt>Reference</dt>
                <dd className="mono">{ref.trim()}</dd>
              </div>
            )}
          </dl>

          <p>
            <a href={jarUrl(recipient.trim(), origin)}>See this jar's history</a>
          </p>
        </>
      ) : null}
        </div>
      </div>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";

import { Replay } from "../components/Replay";
import { TxShape } from "../components/TxShape";
import { getConnection } from "../lib/chain";
import { explorerTxUrl } from "../lib/config";
import { resolveRecipient } from "../lib/domains";
import { formatTimestamp, groupDigits, shortAddress } from "../lib/format";
import { fetchJarHistory, type JarPayment } from "../lib/history";
import { coversAbsence, paymentsForRef } from "../lib/reconcile";
import { encodeRequest, jarUrl, receiptUrl } from "../lib/request";
import {
  SHOWCASE_AMOUNT,
  SHOWCASE_LANDED_REF,
  SHOWCASE_NAME,
  SHOWCASE_SYMBOL,
  freshRef,
  showcaseRequest,
} from "../lib/showcase";
import { fetchTxDetail, type TxDetail } from "../lib/txdetail";
import { navigate } from "../router";
import { Create } from "./Create";

/**
 * The homepage: one live invoice first, the link builder under it. The invoice is the part of
 * Cookie Tab that a form cannot show, a payment settled from whatever token the payer holds, in one
 * signature, with a receipt read back from the chain. Anyone opening the site can pay it.
 */
export function Home(): JSX.Element {
  return (
    <>
      <Showcase />
      <hr className="rule" />
      <Create nested />
    </>
  );
}

/** The most recent payment the refresh job landed under the showcase reference, and what it looked like on chain. */
interface Landed {
  payment: JarPayment;
  detail: TxDetail | null;
}

/**
 * What the read under the button found. `absent` and `unread` are the two honest empties: the first
 * when the jar's history was read to its end and held no such payment, the second when the read
 * stopped early, at its payment limit or its scan cap, and an absence means nothing.
 */
type Proof =
  | { kind: "reading" }
  | { kind: "landed"; landed: Landed }
  | { kind: "absent" }
  | { kind: "unread" }
  | { kind: "unreadable" };

/** As many payments as the receipt page reads, so the two never disagree about what is there. */
const PROOF_LIMIT = 50;

function Showcase(): JSX.Element {
  const connection = useMemo(() => getConnection(), []);
  const [proof, setProof] = useState<Proof>({ kind: "reading" });

  const origin = useMemo(
    () => window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
    [],
  );

  // The proof under the button is the last payment that landed under the showcase reference, read
  // the same way and to the same depth as the receipt page it links to. The name is resolved first,
  // as the invoice and the receipt resolve it: a name can be transferred, and a proof read off the
  // old key would go on describing a jar the invoice no longer pays.
  useEffect(() => {
    let live = true;
    (async () => {
      const resolved = await resolveRecipient(connection, SHOWCASE_NAME);
      if (!live) return;
      const history = await fetchJarHistory(connection, resolved.address, PROOF_LIMIT);
      if (!live) return;
      const [latest] = paymentsForRef(history.payments, SHOWCASE_LANDED_REF);
      if (!latest) {
        setProof({ kind: coversAbsence(history) ? "absent" : "unread" });
        return;
      }
      const detail = await fetchTxDetail(connection, latest.signature).catch(() => null);
      if (!live) return;
      setProof({ kind: "landed", landed: { payment: latest, detail } });
    })().catch(() => {
      if (live) setProof({ kind: "unreadable" });
    });
    return () => {
      live = false;
    };
  }, [connection]);

  // A reference is minted when the button is pressed, not when the page renders, so two tabs from
  // one visit do not share a receipt.
  const pay = (): void => {
    navigate(`/pay/${encodeRequest(showcaseRequest(freshRef()))}`);
  };

  return (
    <section className="hero">
      <h1>Pay this invoice from whatever you hold</h1>
      <p className="lede">
        A live request for {groupDigits(SHOWCASE_AMOUNT)} {SHOWCASE_SYMBOL} on the demo jar. Hold
        only COOK? The page quotes both Cookie Chain routers, checks the winning route against your
        balance, and, when the route fits one transaction, puts the swap, the transfer and the memo
        behind one signature; when it does not, the page swaps first, then pays, and says so. Hold{" "}
        {SHOWCASE_SYMBOL} already? Then it is a plain transfer. Either way the receipt is read back
        from the chain, not from a database.
      </p>
      <div className="amount">
        <span>{groupDigits(SHOWCASE_AMOUNT)}</span>
        <span className="unit">{SHOWCASE_SYMBOL}</span>
      </div>
      <p className="small">
        to <a href={jarUrl(SHOWCASE_NAME, origin)}>{SHOWCASE_NAME}</a>. Each press gets its own
        reference, so your payment lands on its own receipt.
      </p>
      <div className="buttons">
        <button type="button" className="primary" onClick={pay}>
          Pay this invoice
        </button>
      </div>
      <ProofLine proof={proof} origin={origin} />
    </section>
  );
}

function ProofLine({ proof, origin }: { proof: Proof; origin: string }): JSX.Element {
  const receipt = receiptUrl(SHOWCASE_NAME, SHOWCASE_LANDED_REF, origin);
  switch (proof.kind) {
    case "reading":
      return <p className="small">Reading the last payment that landed here from the chain…</p>;
    case "absent":
      return (
        <p className="small">
          No payment under {SHOWCASE_LANDED_REF} is in everything this RPC holds for the jar. A
          public Cookie Chain node keeps roughly ten days, so the last one has aged out of it;{" "}
          <a href={receipt}>its receipt</a> reads the same.
        </p>
      );
    case "unread":
      return (
        <p className="small">
          The last payment under {SHOWCASE_LANDED_REF} is not among the {PROOF_LIMIT} most recent
          payments this page read, so nothing can be said about it from here.{" "}
          <a href={receipt}>Its receipt</a> reads the same jar the same way.
        </p>
      );
    case "unreadable":
      return (
        <p className="small">
          The chain could not be read just now. <a href={receipt}>The last receipt</a> will try again.
        </p>
      );
    case "landed": {
      const { payment, detail } = proof.landed;
      return (
        <>
          <p className="small">
            Last landed {formatTimestamp(payment.blockTime)}
            {detail ? (
              <>
                : <TxShape detail={detail} />
              </>
            ) : (
              "; the transaction itself could not be read back from this RPC just now"
            )}
            . <a href={receipt}>See that receipt</a> or{" "}
            <a href={explorerTxUrl(payment.signature)} className="mono">
              {shortAddress(payment.signature, 8, 6)}
            </a>{" "}
            on the explorer.
          </p>
          {/* Paying needs a funded wallet. This is the same transaction without one. */}
          {detail && <Replay detail={detail} signature={payment.signature} />}
        </>
      );
    }
  }
}

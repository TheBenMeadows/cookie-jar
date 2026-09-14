import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";

import { TxShape } from "../components/TxShape";
import { getConnection } from "../lib/chain";
import { explorerTxUrl } from "../lib/config";
import { formatTimestamp, groupDigits, shortAddress } from "../lib/format";
import { fetchJarHistory, type JarPayment } from "../lib/history";
import { paymentsForRef } from "../lib/reconcile";
import { encodeRequest, jarUrl, receiptUrl } from "../lib/request";
import {
  SHOWCASE_AMOUNT,
  SHOWCASE_JAR,
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

type Proof = { kind: "reading" } | { kind: "landed"; landed: Landed } | { kind: "none" } | { kind: "unreadable" };

function Showcase(): JSX.Element {
  const connection = useMemo(() => getConnection(), []);
  const [proof, setProof] = useState<Proof>({ kind: "reading" });

  const origin = useMemo(
    () => window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
    [],
  );

  // The proof under the button is the last payment that landed under the showcase reference, read
  // the same way the receipt page reads it. The key is used directly rather than the name: the name
  // is for links people follow, and a resolution here would be one more round trip before paint.
  useEffect(() => {
    let live = true;
    (async () => {
      const history = await fetchJarHistory(connection, new PublicKey(SHOWCASE_JAR), 10);
      if (!live) return;
      const [latest] = paymentsForRef(history.payments, SHOWCASE_LANDED_REF);
      if (!latest) {
        setProof({ kind: "none" });
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
        balance, and puts the swap, the transfer and the memo behind one signature. The receipt is
        then read back from the chain, not from a database.
      </p>
      <div className="amount">
        <span>{groupDigits(SHOWCASE_AMOUNT)}</span>
        <span className="unit">{SHOWCASE_SYMBOL}</span>
      </div>
      <p className="small">
        to <a href={jarUrl(SHOWCASE_NAME, origin)}>{SHOWCASE_NAME}</a>, about half a dollar. Each
        press gets its own reference, so your receipt is yours.
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
    case "none":
      return (
        <p className="small">
          The last payment that landed here is older than what the public RPC still holds, about ten
          days, so <a href={receipt}>its receipt</a> reads "no record" rather than guessing.
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
        <p className="small">
          Last landed {formatTimestamp(payment.blockTime)}
          {detail ? (
            <>
              : <TxShape detail={detail} />
            </>
          ) : null}
          . <a href={receipt}>See that receipt</a> or{" "}
          <a href={explorerTxUrl(payment.signature)} className="mono">
            {shortAddress(payment.signature, 8, 6)}
          </a>{" "}
          on the explorer.
        </p>
      );
    }
  }
}

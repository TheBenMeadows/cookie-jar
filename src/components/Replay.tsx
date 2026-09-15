import { useState } from "react";

import { explorerAddressUrl, explorerTxUrl } from "../lib/config";
import { shortAddress } from "../lib/format";
import type { TxDetail } from "../lib/txdetail";

/**
 * A landed transaction, revealed one instruction at a time. Paying the invoice needs a funded
 * wallet, which a visitor may not have; this is the same evidence without one, read from the chain
 * at the moment it is opened rather than recorded here.
 *
 * Each step carries the program's own id, so every line can be checked against the explorer. The
 * sentence beside it is only there for the instructions a Cookie Tab payment is built from; a
 * program this app cannot describe shows its id and its position and nothing invented.
 */
export function Replay({ detail, signature }: { detail: TxDetail; signature: string }): JSX.Element {
  const [shown, setShown] = useState(0);
  const total = detail.steps.length;
  const done = shown >= total;

  if (shown === 0) {
    return (
      <div className="buttons">
        <button type="button" className="quiet" onClick={() => setShown(1)}>
          Step through this transaction
        </button>
      </div>
    );
  }

  return (
    <div className="replay">
      <ol className="rows stacked">
        {detail.steps.slice(0, shown).map((step) => (
          <li className="row" key={step.position}>
            <div className="k">
              <div className="tabular">
                {step.position} of {total}
              </div>
              <div className="mono">
                <a href={explorerAddressUrl(step.programId)} title={step.programId}>
                  {shortAddress(step.programId, 5, 5)}
                </a>
              </div>
            </div>
            <div className="v">
              {step.parsed && <div className="mono">{step.parsed}</div>}
              {step.sentence && <div>{step.sentence}</div>}
              {!step.parsed && !step.sentence && (
                <div>This RPC does not decode this program, so only its id is shown.</div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="buttons">
        {!done && (
          <button type="button" className="quiet" onClick={() => setShown((n) => n + 1)}>
            Next instruction
          </button>
        )}
        {!done && (
          <button type="button" className="quiet" onClick={() => setShown(total)}>
            Show all {total}
          </button>
        )}
        {done && (
          <a className="quiet" href={explorerTxUrl(signature)}>
            All {total} on the explorer
          </a>
        )}
        <button type="button" className="quiet" onClick={() => setShown(0)}>
          Close
        </button>
      </div>
      {done && (
        <p className="small">
          {detail.signatures === 1
            ? `One signature authorised all ${total}.`
            : `${detail.signatures} signatures authorised all ${total}.`}
        </p>
      )}
    </div>
  );
}

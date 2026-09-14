import { explorerAddressUrl } from "../lib/config";
import { shortAddress } from "../lib/format";
import type { TxDetail } from "../lib/txdetail";

/**
 * "11 instructions, one signature, swap through cpamd…n1sGG": the shape of a landed transaction,
 * read from the transaction itself. Each venue links to the explorer, because a program id on a
 * receipt is a claim anyone can check and a name for it would not be.
 */
export function TxShape({ detail }: { detail: TxDetail }): JSX.Element {
  return (
    <>
      {detail.instructions} {detail.instructions === 1 ? "instruction" : "instructions"},{" "}
      {detail.signatures === 1 ? "one signature" : `${detail.signatures} signatures`}
      {detail.venues.length > 0 && (
        <>
          , swap through{" "}
          {detail.venues.map((venue, i) => (
            <span key={venue}>
              {i > 0 ? " and " : ""}
              <a href={explorerAddressUrl(venue)} className="mono" title={venue}>
                {shortAddress(venue, 5, 5)}
              </a>
            </span>
          ))}
        </>
      )}
    </>
  );
}

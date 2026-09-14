import { explorerAddressUrl } from "../lib/config";
import { shortAddress } from "../lib/format";
import type { TxDetail } from "../lib/txdetail";

/**
 * "11 instructions, one signature, through cpamd…n1sGG": the shape of a landed transaction, read
 * from the transaction itself. The programs named are every one beyond the housekeeping set, top
 * level or inner, each linked to the explorer: a program id on a receipt is a claim anyone can
 * check, and calling one of them "the venue" would not be.
 */
export function TxShape({ detail }: { detail: TxDetail }): JSX.Element {
  return (
    <>
      {detail.instructions} {detail.instructions === 1 ? "instruction" : "instructions"},{" "}
      {detail.signatures === 1 ? "one signature" : `${detail.signatures} signatures`}
      {detail.programs.length > 0 && (
        <>
          , through{" "}
          {detail.programs.map((program, i) => (
            <span key={program}>
              {i > 0 ? " and " : ""}
              <a href={explorerAddressUrl(program)} className="mono" title={program}>
                {shortAddress(program, 5, 5)}
              </a>
            </span>
          ))}
        </>
      )}
    </>
  );
}

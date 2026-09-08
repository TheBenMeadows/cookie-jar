import {
  BRIDGE_URL,
  COOKIEBOX_AGG_API,
  COOKIESCAN_API,
  COOKIE_DOMAINS_PROGRAM_ID,
  COOK_MINT,
  COOK_SYMBOL,
  FEE_PER_SIGNATURE_COOK,
  MEMO_PROGRAM_ID,
  RPC_URL,
  explorerAddressUrl,
} from "../lib/config";
import { shortAddress } from "../lib/format";
import { MEMO_PREFIX } from "../lib/request";

/**
 * One address in the reference table. Shortened, because a column of full 44-character keys is a
 * wall nobody reads; the link and its title carry the whole value for anyone comparing one.
 */
function ProgramRow({ label, address }: { label: string; address: string }): JSX.Element {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd className="mono">
        <a href={explorerAddressUrl(address)} title={address}>
          {shortAddress(address, 6, 6)}
        </a>
      </dd>
    </div>
  );
}

/** The reference page: what the app does on chain, and which addresses it touches. */
export function About(): JSX.Element {
  return (
    <>
      <h1>How Cookie Jar works</h1>
      <p className="lede">
        A payment link carries the whole request. There is no account, no database, and no server
        holding anything on your behalf.
      </p>

      <h2>The link</h2>
      <p>
        Creating a link encodes the recipient, the amount, the token, a note and an optional
        reference as base64url JSON, and puts that in the URL fragment after <span className="mono">#/pay/</span>.
        A fragment never leaves the browser, so the request is not in this app's logs or in a CDN's.
        The Pay page decodes the same string. If the app disappears, the link still holds everything
        a payer would need to build the transfer by hand.
      </p>

      <h2>The payment</h2>
      <p>
        Paying builds one Cookie Chain transaction. For {COOK_SYMBOL} it is a system transfer; for an
        SPL token it is a checked transfer, plus an idempotent instruction creating the recipient's
        token account when they do not have one yet. Every payment also carries an SPL memo beginning{" "}
        <span className="mono">{MEMO_PREFIX}</span>, holding the reference and the note.
      </p>
      <p>
        Your wallet signs it and sends it. The funds move from your address to the recipient's
        address in that one transaction, and the network fee is {FEE_PER_SIGNATURE_COOK}{" "}
        {COOK_SYMBOL}.
      </p>

      <h2>The jar</h2>
      <p>
        A jar page lists what arrived. It calls{" "}
        <span className="mono">getSignaturesForAddress</span> on the recipient, reads each
        transaction, and keeps the ones whose memo starts with the Cookie Jar prefix, taking the
        amount from the transaction's own balance changes. Nothing is indexed anywhere: point any
        Solana RPC client at Cookie Chain and you can rebuild the same list.
      </p>
      <p className="small">
        Transfers to the same address that carry no Cookie Jar memo are left out. A jar shows Cookie
        Jar payments, not a full account statement.
      </p>

      <h2>Names</h2>
      <p>
        A recipient can be written as a CookOven <span className="mono">.cook</span> name. The name
        is read from the registry program directly, one program-derived address per lookup. A name
        that is listed for sale on the <span className="mono">.cook</span> marketplace is refused
        rather than resolved, because the registry then points it at the marketplace escrow, and
        paying that would put the money where nobody can spend it.
      </p>

      <h2>Prices and swaps</h2>
      <p>
        A request can fix a dollar amount instead of a token amount. The Pay page converts it at the
        Cookiescan price when the payer opens the link, and shows the token amount before they sign.
        Nothing is pegged; the dollar figure is a display over a plain token transfer.
      </p>
      <p>
        A payer who holds the wrong token gets a route from the Cookiebox and Candy Shop aggregators.
        The better of the two quotes wins. The swap is its own transaction, built by the aggregator,
        signed by the payer's wallet, and sent from this page — the funds never pass through Cookie
        Jar.
      </p>

      <h2>No COOK yet</h2>
      <p>
        Move {COOK_SYMBOL} across from Solana over the Hyperlane warp route:
        <br />
        <a href={BRIDGE_URL}>{BRIDGE_URL}</a>
      </p>

      <hr className="perf" />

      <h2>What this app touches</h2>
      <dl className="rows stacked">
        <div className="row">
          <dt>RPC</dt>
          <dd className="mono">{new URL(RPC_URL).host}</dd>
        </div>
        <ProgramRow label="Native token" address={COOK_MINT} />
        <ProgramRow label="Memo program" address={MEMO_PROGRAM_ID.toBase58()} />
        <ProgramRow label="CookOven registry" address={COOKIE_DOMAINS_PROGRAM_ID.toBase58()} />
        <div className="row">
          <dt>Prices and tokens</dt>
          <dd className="mono">{new URL(COOKIESCAN_API).host}</dd>
        </div>
        <div className="row">
          <dt>Swap routes</dt>
          <dd className="mono">{new URL(COOKIEBOX_AGG_API).host}</dd>
        </div>
      </dl>

      <p className="small">
        Cookie Jar holds no keys and takes no fee. Read the source before you trust it with an
        invoice.
      </p>
    </>
  );
}

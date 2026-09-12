# Cookie Jar

Payment links and tip jars on Cookie Chain.

Fill in a form and you get a short link and a QR code. Whoever opens it connects a wallet and pays you in COOK or any Cookie Chain token. Both sides get a receipt on chain, and the jar page lists every payment that has arrived.

Cookie Jar has no backend. The payment request is carried inside the link, and the history is read back out of the chain.

## Making a request and getting paid

Create a request. Pick a recipient (a Cookie Chain address or a CookOven `.cook` name), a token, and an amount. The amount can be fixed in the token, fixed in US dollars, or left open for a tip jar. Add a label, a note and an invoice reference if you want them.

Share the link. The request is encoded as base64url JSON in the URL fragment after `#/pay/`. A fragment is never sent to a server, so the request does not appear in this app's logs, in a CDN's, or in a referrer header. The same string is also rendered as a QR code.

Get paid. The Pay page decodes the link, resolves the name against the CookOven registry, shows the amount and its dollar value, and builds one transaction. The payer's wallet signs it, and the page sends the signed transaction to the Cookie Chain RPC itself: a wallet asked to send would broadcast it on Solana mainnet, because the wallet-standard adapter maps any RPC host it does not know to mainnet. A payer holding the wrong token can swap first, in the same page, through the Cookie Chain aggregators.

Read the jar. The Jar page lists what arrived, totalled by token, with a link to each transaction on Cookiescan.

## How it works on chain

Every payment is one Cookie Chain transaction:

- native COOK: a `SystemProgram.transfer`
- an SPL token: a `TransferChecked`, preceded by an idempotent create for the recipient's associated token account. The create rides along on every token payment — it costs nothing when the account is already there, and it names the recipient's wallet among the transaction's account keys, which is what lets their jar find the payment afterwards
- both: an SPL Memo instruction whose text starts with `cookiejar:1`

The memo is what makes a jar readable. A jar is more than one address — native COOK lands on the wallet, an SPL transfer lands on a token account the wallet owns, and the two index separately — so `Jar` lists the recipient's wallet plus every token account under it, calls `getSignaturesForAddress` on each, merges the results into one list in block order, fetches each transaction, keeps the ones whose memo starts with the prefix, and takes the amount from the transaction's own `preBalances`/`postBalances` and `preTokenBalances`/`postTokenBalances`. No indexer and no database are involved: any Solana RPC client pointed at Cookie Chain can rebuild the same list.

A `.cook` name is read straight from the CookOven registry program. `resolveRecipient` derives the `["domain", label]` program address, reads the account, and decodes the owner. A name that is listed for sale on the `.cook` marketplace is refused rather than resolved. The registry then points it at the marketplace escrow, which is program-owned and has no signer, so paying it would send the money somewhere nobody can spend it.

A dollar-quoted request is converted at the Cookiescan price when the payer opens the link, in the browser, and the token amount is shown before they sign. Nothing is pegged and nothing is escrowed. The conversion is fixed-point BigInt arithmetic throughout, because a COOK amount that fits an ordinary invoice already exceeds what a double holds at 9 decimals.

The swap step asks both Cookie Chain aggregators for a route and keeps the larger output. Whichever one won then builds it (Cookiebox through `POST /swap-tx`, Candy Shop through `POST /swap-tx/multi-route`) and returns an unsigned versioned transaction whose fee payer is the payer's own wallet. Cookie Jar simulates it, the wallet signs it, and this page sends it. The funds never pass through the app, and the swap is a separate transaction from the payment, so a payer can stop after either one.

Cookie Jar does not hold keys, does not take a fee, and does not deploy a program of its own.

## Addresses and endpoints

| What | Address or host |
| --- | --- |
| RPC | `https://rpc.cookiescan.io` |
| Websocket | `wss://wss.cookiescan.io` |
| Native COOK (wrapped mint) | `So11111111111111111111111111111111111111112` |
| SPL Memo v2 | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| CookOven `.cook` registry | `H43Qtq4AMQ86y7yc3YtCKZJ2QMhhnCcHyZKeFeoQn7PA` |
| CookOven `.cook` marketplace | `Ey35mr69UfiQqZSwD2qYAZoMNfnuVJGCjwNSB64ppHm7` |
| Prices, tokens, DAS | `https://api.cookiescan.io` |
| Cookiebox aggregator | `https://agg.cookiebox.app` |
| Candy Shop aggregator | `https://swap.cookiescan.io/api` |
| Explorer | `https://cookiescan.io` |
| COOK bridge from Solana | `https://bridge.cookiescan.io` |

Cookie Jar deploys no program and owns no address. It reads and writes only through the programs above.

## Setup

Node 22 or later is required.

```
npm install
npm run dev
```

The dev server prints a local URL. Open it, connect a wallet, and make a link.

```
npm run build      # typecheck, then a static bundle in dist/
npm run preview    # serve dist/ locally
npm test           # 88 unit and render tests, no network
npm run live       # 19 checks against the live chain, no key, no funds
npm run lint
```

## Environment variables

Every one is optional. The defaults are the public Cookie Chain endpoints, and the app runs with no `.env` file at all.

| Variable | Default |
| --- | --- |
| `VITE_COOKIE_RPC_URL` | `https://rpc.cookiescan.io` |
| `VITE_COOKIE_WS_URL` | `wss://wss.cookiescan.io` |
| `VITE_COOKIESCAN_API_URL` | `https://api.cookiescan.io` |
| `VITE_COOKIEBOX_AGG_URL` | `https://agg.cookiebox.app` |
| `VITE_CANDYSHOP_API_URL` | `https://swap.cookiescan.io/api` |
| `VITE_COOKIE_EXPLORER_URL` | `https://cookiescan.io` |
| `VITE_REPO_URL` | this repository |

Set a private RPC through `VITE_COOKIE_RPC_URL` if the public one rate-limits you. No variable holds a secret. The app never sees a key.

## Deploying

The build is a directory of static files. Routing is in the URL fragment, so any file host serves it as it stands, with no rewrite rules and no environment secrets.

On Cloudflare Pages:

- build command: `npm run build`
- build output directory: `dist`
- Node version: 22 or later

Any other static host works the same way. Upload `dist/`.

## The live checks

`npm run live` runs 19 checks against Cookie Chain and the ecosystem APIs. It signs nothing and sends nothing, so it runs without a key and without funds. It covers the link round-trip, `.cook` resolution for a registered and an unregistered name, the dollar quote, the token registry, a COOK transfer, an SPL transfer, both aggregators, a built swap transaction, and the jar history read — including one known payment into the demo jar, read back from the chain with its amount and its reference for as long as the retention window holds it.

The transfer checks run twice over. Once as a real holder with signature verification off, which proves the transaction is valid end to end. Once as a freshly generated keypair, which must fail with `AccountNotFound` and nothing else. An address that has never held COOK has no account on chain, so that error is the whole of what is wrong, and it proves the rest of the transaction is well formed.

## The funded end-to-end test

The checks above never move money. To confirm a real payment, one funded wallet is needed.

1. Bridge a small amount of COOK from Solana at `https://bridge.cookiescan.io`. A payment costs 0.000005 COOK in fees, so a dollar of COOK covers thousands of them; the amount to bridge is set by what you want to send, not by the fee.
2. Open the app, connect that wallet, and make a link paying a second address a small amount of COOK.
3. Open the link in another browser or another profile, connect the funded wallet, and pay.
4. Read the signature on the receipt against `https://cookiescan.io/tx/<signature>`, and confirm the transaction contains an SPL Memo instruction whose text starts with `cookiejar:1`.
5. Open the jar page for the recipient. The payment must appear with the right amount, note and reference.

Step 5 is the one that matters. It proves the history is rebuilt from chain data with nothing stored anywhere.

## Known limits

A jar sees only as far back as its RPC retains. `getSignaturesForAddress` can answer only for blocks the node still holds, and the public Cookie Chain endpoint keeps a rolling window: measured on 2026-09-08, `getFirstAvailableBlock` was 21,802,517 against slot 23,978,778, which is about 2.2 million slots, or roughly ten days. Payments older than the window are on chain but not in the index, and no client can list them from that endpoint. `npm run live` prints the current figure. An archival RPC set through `VITE_COOKIE_RPC_URL` sees further.

Within the window, a jar pages back through the signatures of its wallet and of the token accounts it owns, a page at a time from each in turn, until it has 50 Cookie Jar payments or has read 1,000 signatures across all of those addresses. The page says which of the two stopped it: it shows the latest 50 when more payments remain to be read, and names the 1,000-signature cap when that ran out first. At most 30 token accounts are read alongside the wallet, the ones holding a balance first, because a wallet can carry hundreds of empty accounts left behind by airdrops and each one costs a request.

A transfer to a jar's address without a Cookie Jar memo is left out. A jar lists Cookie Jar payments. Read the address on Cookiescan for a full account statement.

A jar row records what the chain recorded, and nothing more. Anyone can send a jar a small amount with a memo that starts with `cookiejar:1` and a note of their choosing, and it appears in the history like any other payment. Every row links to its transaction on Cookiescan. Check the amount and the sender there before treating a row as a settled invoice.

The swap step seeds its input amount from the two Cookiescan prices plus 3% headroom, because both aggregators quote exact-in rather than exact-out. The quote below the field is what the router actually offers, and the payer can change the number and re-quote.

`npm audit` reports advisories in the Solana dependency tree, none of them in this app's own code and none with a fix that keeps the SDK working. One reaches the shipped bundle: `bigint-buffer`, pulled in by `@solana/spl-token`, whose advisory concerns its native Node addon; browsers never load that addon and run the package's plain JavaScript path instead. The others (`jayson`, `stream-json`, `uuid` under `@solana/web3.js`, and the React Native packages under `@solana/wallet-adapter-react`'s mobile support) are Node-only or mobile-only and are not in the bundle the page serves. The build tooling itself (Vite, Vitest, esbuild) is kept at versions with no open advisory.

## Licence

MIT.

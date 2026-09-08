# Superteam Earn submission — Cookie Jar

Bounty: Create an App on Cookie Chain. $1,000 USDC, two prizes of $500. Deadline 2026-09-22 21:59 UTC.

Nothing in this file has been posted or submitted. Every draft below waits on Ben.

## Form answers

**Project name**

Cookie Jar

**Live URL**

`[PENDING — Cloudflare Pages deploy; see HANDOFF.md]`

**GitHub repository**

`[PENDING — repository not yet created; see HANDOFF.md]`

**One-line description**

Payment links and tip jars on Cookie Chain: make a link, share it, get paid, and read the jar back off the chain.

**What it does**

Cookie Jar turns a payment request into a link and a QR code. A creator or a merchant picks a recipient, a token and an amount, and gets a URL. Whoever opens it connects a wallet and pays. Both sides get an on-chain receipt, and a public jar page lists every payment that has arrived at that address.

The request is encoded into the URL fragment, so Cookie Jar stores nothing and needs no backend. Every payment carries an SPL memo, so a jar's history is rebuilt from chain data alone: any Solana RPC client pointed at Cookie Chain can produce the same list without this app.

**Cookie ecosystem integrations used**

- CookOven `.cook` names. Recipients can be written as `baker.cook`. Names are read straight from the registry program at `H43Qtq4AMQ86y7yc3YtCKZJ2QMhhnCcHyZKeFeoQn7PA`, one program-derived address per lookup, with no API in between. A name listed for sale on the `.cook` marketplace is refused rather than resolved, because it then points at the marketplace escrow.
- Cookiescan. The price feed quotes a request in US dollars and converts it to tokens when the payer opens the link. The token registry supplies decimals and tickers for any Cookie Chain token, and the explorer links every receipt.
- Cookiebox aggregator. A payer holding the wrong token gets a route from `agg.cookiebox.app`, and the swap transaction is built there, simulated here, and signed by the payer's own wallet.
- Candy Shop aggregator. Quoted alongside Cookiebox, and it builds the swap when its route wins.
- cookie-mcp. The `.cook` account layouts, discriminators and program identifiers in `src/lib/domains.ts` follow `cookiechain/cookie-mcp`, which pins them against the deployed IDL.
- Cookie Chain Bridge. The Pay page sends a payer with no COOK to `https://bridge.cookiescan.io`.

**On-chain interaction**

Every payment is a real Cookie Chain transaction. Native COOK moves by `SystemProgram.transfer`; an SPL token moves by `TransferChecked`, with an idempotent create for the recipient's token account when they do not have one. Both carry an SPL Memo instruction. Swaps are separate transactions built by the aggregators and signed by the payer.

**Addresses and programs touched**

| What | Address or host |
| --- | --- |
| RPC | `https://rpc.cookiescan.io` |
| Native COOK (wrapped mint) | `So11111111111111111111111111111111111111112` |
| SPL Memo v2 | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| CookOven `.cook` registry | `H43Qtq4AMQ86y7yc3YtCKZJ2QMhhnCcHyZKeFeoQn7PA` |
| CookOven `.cook` marketplace | `Ey35mr69UfiQqZSwD2qYAZoMNfnuVJGCjwNSB64ppHm7` |
| Cookiescan API | `https://api.cookiescan.io` |
| Cookiebox aggregator | `https://agg.cookiebox.app` |
| Candy Shop aggregator | `https://swap.cookiescan.io/api` |
| Bridge | `https://bridge.cookiescan.io` |

Cookie Jar deploys no program and owns no address. It holds no keys and takes no fee.

**Open source**

MIT. Repository link above.

**Demo transaction**

`[PENDING — the funded end-to-end test in README.md produces this signature]`

## X thread draft

Not posted. Ben approves before anything goes out.

**1/**

Cookie Jar: payment links and tip jars on Cookie Chain.

Make a link. Share it. Get paid. Read the jar back off the chain.

No accounts, no backend, no fee.

`[LIVE URL]`

**2/**

You fill in a recipient, a token and an amount, and you get a URL plus a QR code.

The whole request is encoded in the URL fragment. A fragment never reaches a server, so Cookie Jar stores nothing about it. If the site vanished tomorrow the link would still contain everything a payer needs.

**3/**

The recipient can be a `.cook` name.

`baker.cook` resolves against the CookOven registry program directly, one PDA read, no API. A name that is listed for sale is refused instead of resolved, because a listed name points at the marketplace escrow rather than a wallet.

**4/**

Invoices can be priced in dollars.

Ask for $25 and the Pay page converts it at the Cookiescan price when the payer opens the link, then shows the COOK figure before they sign. Nothing is pegged. It is a plain transfer with a display on top.

**5/**

Holding the wrong token is not a dead end.

Cookie Jar quotes both Cookiebox and Candy Shop, keeps the better route, and lets the payer swap and then pay. Two transactions, both signed by their own wallet. The funds never pass through the app.

**6/**

Every payment carries an SPL memo starting `cookiejar:1`.

That is what makes a jar readable. The jar page runs `getSignaturesForAddress`, keeps the transactions with that memo, and reads the amounts from the balance deltas. No indexer, no database. Any RPC client can rebuild the same list.

**7/**

Need COOK first? The Hyperlane warp route moves it across from Solana:

https://bridge.cookiescan.io

A payment costs 0.000005 COOK in fees, so a dollar of COOK covers thousands of them.

**8/**

Source, addresses, and a live check suite that runs against the real chain with no key and no funds:

`[REPO URL]`

Built for the Cookie Chain app bounty on @SuperteamEarn.

## Telegram share line

Cookie Jar — payment links and tip jars on Cookie Chain. Make a link, share it, get paid; the jar's history is read straight back off the chain, with no backend anywhere. `.cook` names, dollar pricing through Cookiescan, and a Cookiebox/Candy Shop swap step for payers holding the wrong token. Live at `[LIVE URL]`, source at `[REPO URL]`.

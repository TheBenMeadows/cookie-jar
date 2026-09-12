# Cookie Tab wire format

Everything Cookie Tab writes is either a URL or an SPL Memo, and both are documented here so a wallet, a script, or an agent can make a request, pay one, or read a jar without this app.

Version 1. The memo prefix `cookiejar:1` is fixed; a change to the memo layout would take a new prefix, and a change to the link layout takes a new `v`.

## The payment link

```
https://cookie-tab.pages.dev/#/pay/<payload>
```

`<payload>` is `base64url(JSON)` with no padding: standard base64 with `+` → `-`, `/` → `_`, trailing `=` removed. It sits in the URL fragment, which a browser never sends to a server. The JSON is one object:

| Key | Type | Meaning | Limit |
| --- | --- | --- | --- |
| `v` | number | Format version. `1`. | must be `1` |
| `to` | string | Recipient: a base58 Cookie Chain address, or a CookOven name ending in `.cook`. A name resolves at pay time, never at link time. | required |
| `l` | string | Label — who is being paid, shown above the amount. | 60 chars |
| `n` | string | Note — what the payment is for. Goes on chain in the memo, so it is public. | 180 chars |
| `a` | string | Fixed amount in display units, as a decimal string (`"1500.49"`). | > 0 |
| `m` | string | Token mint. Absent, or the COOK mint `So11111111111111111111111111111111111111112`, means native COOK. | base58 |
| `d` | number | Decimals of `m`. Required when `m` is present. The Pay page reads the mint from the chain and refuses the link if they disagree. | 0–18 |
| `s` | string | Ticker of `m`, for display only. The asset registry's ticker wins when it has one. | 12 chars |
| `u` | string | Fixed dollar amount, as a decimal string with at most two places (`"25.00"`). Converted at the Cookiescan price when the payer opens the link. | > 0 |
| `r` | string | Reference: an invoice number, an order id. Goes in the memo's fixed field. | 40 chars |

`a` and `u` are alternatives, and a link holds at most one of them. With neither, the request is open: the payer names the amount.

Strings are trimmed and Unicode format characters (category Cf) are stripped before the limits apply, so a right-to-left override cannot reorder the words beside an amount.

Example: 25,000 COOK to `baker.cook` for invoice `INV-2026-014`.

```json
{"v":1,"to":"baker.cook","l":"Bakery Tab","n":"One dozen sourdough, Friday collection","a":"25000","r":"INV-2026-014"}
```

## The memo

Every Cookie Tab payment carries one SPL Memo instruction (program `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`), signed by the payer:

```
cookiejar:1|<ref>|<note>
```

- The prefix is literal. A jar keeps transactions whose memo starts with `cookiejar:1|` and drops the rest.
- `<ref>` is the link's `r` with any `|` written as `/`, so an invoice number survives a note that itself contains a `|`. Empty when the link has none.
- `<note>` is the link's `n` with line breaks written as spaces. Everything after the second `|` is the note, `|` included.
- The whole memo is cut at 233 bytes (`11 + 2 + 40 + 180`).

Reading one back: split off the prefix; the text up to the first `|` is the reference, the rest is the note. A memo that does not start with `cookiejar:1|` is not a Cookie Tab payment.

## The transaction

One Cookie Chain transaction, fee payer = payer, one signature:

- native COOK: `SystemProgram.transfer(payer → recipient, lamports)`
- an SPL or Token-2022 token: `createAssociatedTokenAccountIdempotent(payer pays, recipient's ATA)` then `TransferChecked(payer's account → recipient's ATA, amount, decimals)`. The idempotent create rides on every token payment: it costs nothing when the account exists, and it names the recipient's wallet among the account keys, which is what puts the transaction in `getSignaturesForAddress(wallet)`.
- optionally a second transfer of the same token to the Cookie Jar treasury `568tU9FMksJDxjkLBjWisSA4J4C5uPH87NCCkyREwrxe`, when the payer opts in
- last, the Memo instruction above

A `.cook` recipient is resolved by reading the CookOven registry program `H43Qtq4AMQ86y7yc3YtCKZJ2QMhhnCcHyZKeFeoQn7PA` at the `["domain", label]` program address and decoding the owner. A name listed on the marketplace resolves to the marketplace escrow, a program-owned account with no signer: refuse it rather than pay it.

## Paying a link as an agent

With [cookie-mcp](https://github.com/cookiechain/cookie-mcp), the request is one `transfer` call. The Pay page offers the exact call under "For an agent":

```json
{"tool":"transfer","to":"baker.cook","amount":"25000","memo":"cookiejar:1|INV-2026-014|One dozen sourdough, Friday collection"}
```

`mint` is present for a token payment and absent for COOK. `memo` is the memo above, already built. The `memo` parameter on `transfer` is [cookie-mcp PR #3](https://github.com/cookiechain/cookie-mcp/pull/3). Without it a transfer lands untagged and the jar cannot match it to the reference.

Without cookie-mcp: decode the payload, resolve the name if there is one, build the transaction above, sign, send to `https://rpc.cookiescan.io`, and poll `getSignatureStatuses`. The chain's websocket endpoint presents a certificate for another host, so a subscription never hears the signature.

## Reading a jar

A jar is the recipient's wallet plus every token account it owns under the Token and Token-2022 programs. For each address:

1. `getSignaturesForAddress`, newest first.
2. Skip entries whose `memo` summary is present and lacks `cookiejar:1`.
3. Fetch the rest with `getParsedTransactions` (`maxSupportedTransactionVersion: 0`) and drop failed transactions.
4. Keep those with a memo instruction whose text parses as above.

The amount received is the jar's own delta in the transaction's `preBalances`/`postBalances` (native) and `preTokenBalances`/`postTokenBalances` matched by account index and summed per mint (tokens). The sender is account key 0, the fee payer.

The jar page is `#/jar/<recipient>`. Narrowed to one reference it is the receipt page: `#/jar/<recipient>?ref=<reference>`, with the reference URL-encoded. A reference is settled when the payments tagged with it, in the requested token, reach the requested amount. Below that amount it is part-paid. With none arrived it is unpaid.

A reference is text anyone can put in a memo. The transaction link is the evidence. A public Cookie Chain RPC keeps roughly the last ten days of signatures. A payment older than that is on chain but not readable this way.

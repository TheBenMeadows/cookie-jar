# Review: Cookie Tab, homepage live invoice (PR #23) — round 3

You are reviewing a merged change to Cookie Tab, a static React app on Cookie Chain (a Solana fork; `@solana/web3.js` works unchanged) that makes payment links, pays them, and reads receipts back from the chain with no backend. Answer as a forensic reviewer who also reads frontend code closely. Be specific and concrete; cite file and line; no compliments; do not restate the artifact. Rank findings by expected impact. Under 900 words.

Read the listed files if you can. Run nothing. Write nothing. Put your whole answer in your final message.

## The target

A judge opening the site should, within a minute, pay a real invoice from whatever token they hold, sign once, and land on a receipt that is rebuilt from chain data. The homepage now leads with that invoice; a receipt now describes the landed transaction's shape (instruction count, signature count, swap venue) read from the chain.

## Earlier rounds

Round 1 (09-12) produced the one-transaction swap-and-pay checkout and the memo-based receipt. Round 2 (09-13, 8 lanes) found that a settled invoice older than the RPC's ~10-day window rendered "Not paid"; fixed with a fourth state `unknown` gated on history coverage (`reconcile.ts`, `coversAbsence`). Do not re-prescribe either.

## What it does now (the part under review)

- `src/pages/Home.tsx`: the `#/` route renders `Showcase` then the existing `Create` form (heading demoted to an `h2`). `Showcase` shows a fixed invoice: 700 TRASHCOIN (mint `GNFq…5T6z`, 9 decimals) to `cookietab.cook`. Pressing "Pay this invoice" calls `freshRef()` and navigates to `#/pay/<encoded request>`. Under the button, an effect reads the demo jar's history (`fetchJarHistory(connection, SHOWCASE_JAR, 10)`), takes the newest payment carrying `LANDING-COMPOSED`, and fetches that transaction's shape with `fetchTxDetail`. Four proof states: reading, landed, none, unreadable.
- `src/lib/showcase.ts`: constants and `freshRef` (6 chars from a 32-letter alphabet, `crypto.getRandomValues`), `showcaseRequest(ref)`.
- `src/lib/txdetail.ts`: `summarizeTransaction(parsedTx)` returns signature count, top-level instruction count, inner instruction count, `venues` (top-level program ids not in a housekeeping set: system, compute budget, token, token-2022, ATA, memo), `hasMemo`. `fetchTxDetail` wraps `getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 })` and returns null when the node no longer holds the transaction.
- `src/components/TxShape.tsx`: renders "11 instructions, one signature, swap through cpamd…n1sGG" with each venue linked to the explorer.
- `src/pages/Jar.tsx`: on a receipt (`?ref=`), an effect fetches `TxDetail` for up to 5 distinct matching signatures and renders `TxShape` under each matching row.
- The Pay page (`src/pages/Pay.tsx`, unchanged, included for context) only offers the swap panel when the payer is short of the invoice token. That is why the invoice is in TRASHCOIN rather than COOK: a wallet holding only COOK is short, so paying it takes the composed swap-and-pay path.

Settled and NOT under review: the memo format `cookiejar:1|<ref>|<note>`, the settlement states, the swap verification in `swap.ts`/`checkout.ts`, the wallet adapter setup.

## The standing verdict

Owner's words: "Field of 13 submissions; the organizer called ours identical to Sprinkle. The homepage was a link builder. Item 4 makes the differentiator the first thing a judge sees." Verified before merge: typecheck and lint clean, 143 unit tests, 26 live checks against the real chain (the landed checkout reads back as 11 instructions, 1 signature, venue `cpamdp…`), rendered at 390x844 and 1280x900.

## Attached from our side

Files under this directory, absolute paths:

- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/pr23.diff` — the full diff of the change (36 KB).
- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Home.tsx` — new.
- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/lib/showcase.ts` — new.
- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/lib/txdetail.ts` — new.
- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/components/TxShape.tsx` — new.
- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Jar.tsx` — modified (receipt rows).
- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Pay.tsx` — unchanged, context.
- `/Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/lib/reconcile.ts`, `history.ts`, `request.ts` — unchanged, context.

## Questions

1. **Correctness** — Where can `Home.tsx` or `Jar.tsx` render something false or misleading from real chain data? Consider: a `LANDING-COMPOSED` payment in two assets (two rows, one signature); a matching payment whose transaction the node lists but will not return; a jar read that hits the scan cap; an effect racing a route change; `details` state carrying stale entries after `refFilter` changes.
2. **The reference** — `freshRef` mints `TAB-` plus six characters per press. Is anything about its randomness, its collision behaviour, or the fact that the reference travels in a public link a real problem for the receipt that lands on it? Is `crypto.getRandomValues` guaranteed on every browser this app can run in?
3. **`summarizeTransaction`** — What does `venues` misreport on a real composed transaction: a router that CPI-calls venues from its own program (the router's id would appear, not the venue's), a lookup-table transaction, an inner-only memo? Is "swap through <program id>" the honest label, or should the line say something else?
4. **The judge's path** — A judge holding only COOK presses Pay. Trace `Pay.tsx` from the decoded request: what do they see if TRASHCOIN's price is missing from the registry, if the two routers disagree, if the composed transaction exceeds 1,232 bytes, if they hold TRASHCOIN already? Anything that would make them stop before signing that the homepage copy does not warn about?
5. **Cut** — Which line of the new copy or code would you delete as unearned, and why?

Do not edit any files.

Read everything. Findings ranked.

## 1. The "none" proof state asserts a cause it cannot establish (Home.tsx:64-67, 120-124)

`fetchJarHistory(connection, SHOWCASE_JAR, 10)` returns the newest **10 payments**. `paymentsForRef` empty → `kind: "none"` → the copy claims the last `LANDING-COMPOSED` payment "is older than what the public RPC still holds, about ten days." But an empty match also means: the payment fell off the newest-10, the scan hit `SCAN_CAP`, or the token-account list was truncated. Round 2 built `coversAbsence` (`reconcile.ts:44-47`) precisely for this, and Home doesn't use it.

The kicker: this degrades itself. Every judge who pays the homepage invoice adds a payment to this jar — the demo's own traffic pushes the landed payment past position 10, after which the homepage tells judges a payment that landed yesterday is "older than ten days." It also contradicts the receipt it links: the `?ref=LANDING-COMPOSED` receipt reads with limit 50 and may show "Paid" while the homepage insists there's no record.

## 2. Proof scans the key; the invoice pays the name (Home.tsx:57-62 vs showcase.ts:59)

The effect reads `SHOWCASE_JAR` (base58) but `showcaseRequest` sets `to: SHOWCASE_NAME`, and the receipt link resolves `cookietab.cook` at open time. `Pay.tsx:243-249` re-resolves the name before signing because names transfer — the hazard is acknowledged in the same codebase. If the name moves, payments land on the new owner while the proof keeps reading the old jar: "Last landed" goes stale forever and the linked receipt resolves the new jar and says "No record." The comment calls the skipped resolution "one more round trip before paint" — it trades correctness for it silently.

## 3. `venues` is labeled "swap through" but measures "invoked" (txdetail.ts:51-61, TxShape.tsx:17)

- On a router-composed swap the router CPIs the venue; the top-level id is the router's and the actual venue lives in `innerInstructions`, which are never scanned. The receipt would say "swap through [router]" — arguably true — but a judge checking the program id sees the aggregator, not the venue.
- Worse, *any* non-housekeeping top-level program is called a swap venue. Ed25519/Secp256k1 sig-verify precompiles, a second memo program version (if `MEMO_PROGRAM_ID` is v2, `Memo1Uhk…` renders as a venue), or any unrelated bundled instruction all produce "swap through X" on transactions with no swap. The honest label is "invoked" or "through program."
- `instructions` counts compute-budget no-ops (`txdetail.ts:38` counts all top-level), so "11 instructions" is inflated by housekeeping the same code elsewhere calls meaningless.
- `innerInstructions` and `hasMemo` are collected and never rendered — `hasMemo` feeds only the live-check assert. Two dead fields, and the hidden one (`innerInstructions`) is where a router swap's legs actually are.

## 4. Stale `details` and transient-vs-pruned conflation (Jar.tsx:147-166; Home.tsx:69)

`details` is never cleared when `payments` or `refFilter` change; the `signatures.length === 0` early return leaves old entries in state. Not currently rendered wrong (lookup is by signature, which is unique), but the map is keyed state that survives its inputs — a fragile pattern. More real: `.catch(() => null)` in both files makes an RPC hiccup indistinguishable from "the node pruned it" — a transient failure silently drops the shape line instead of surfacing as `unreadable`, inconsistent with the outer catch.

## 5. The judge's stalls on Pay.tsx

- `payBlocker` at `Pay.tsx:230` renders a disabled button reading "You need more TRASHCOIN than this wallet holds" — a refusal, sitting directly above the SwapPanel that is the actual path. Nothing at the button says "or swap below." The homepage promises router quotes; the pay page's first signal is rejection.
- After signing, `signatureOutcome` polls over HTTP (`Pay.tsx:278-279`, ws unavailable), but `stage: "sending"` keeps the button at "Waiting for your wallet…" (`Pay.tsx:228`) for the whole confirmation window. The wallet prompt is gone; a judge may reopen their wallet or abandon.
- Missing TRASHCOIN price is graceful (`Pay.tsx:108-115` — `.catch → null`, no USD line). Registry *decimals* are not cross-checked at runtime the way `registrySymbol` is — the live-check asserts `decimals === 9`, but between merge and judging a registry drift prices the invoice off by 10^k.
- If the composed tx exceeds the packet limit and SwapPanel falls back to swap-then-pay, the "one signature" promise in the homepage copy is broken silently — the copy has no "when the route allows" qualifier.
- Already holding TRASHCOIN works fine: plain transfer+memo, receipt honestly shows no venue.

## 6. `freshRef` — mostly fine

`byte % 32` is unbiased (256 = 8×32, showcase.ts:51). ~1.07e9 space; 50% collision needs ~33k refs — irrelevant for judging, and a collision just lists two rows honestly. `getRandomValues` is *not* secure-context-gated (unlike `randomUUID`/`crypto.subtle`), so HTTP/file:// serving is safe; the only gap is `pay()` (`Home.tsx:82-84`) has no error surface — on a crypto-less WebView the primary button silently throws. Public ref is not a problem: receipts are disambiguation, not auth, and the receipt copy already says anyone can write a memo. 

## 7. Cut

`Home.tsx:100` "about half a dollar" — a price claim with no price source. `showcase.ts:18-19` admits it's frozen "at the time it was set" to keep the feed out of the hot path, but the rendered copy doesn't carry the caveat; when TRASHCOIN moves, the first concrete number a judge reads is wrong by however much it moved. Delete the claim or say what it costs in the request's own terms. Runner-up: `innerInstructions`/`hasMemo` — unearned fields the UI never spends.

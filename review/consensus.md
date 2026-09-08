# Council consensus — Cookie Jar, round 1 (code + design), 2026-09-08

## Lanes

| Lane | Route | Saw | Result |
|---|---|---|---|
| Gemini | agyx, absolute paths | 10 source files | 7,948 B; 11 claims, 6 reproduced, 3 refuted, 2 low-value |
| DeepSeek V4 Pro | ccx, sources appended (rerun after the `${=L}` word-split trap emptied the first attempt — it correctly refused to fabricate) | 10 source files | 6 claims, 4 reproduced, 1 refuted, 1 documented limitation |
| Design critic | Opus, screenshots + 4 references only, no code | 8 candidate screens, 4 refs (3 refs failed to capture; recaptured Stripe Checkout, Coinos, PayPal.me for round 2) | 5 changes, all deletions/consistency; pay-fixed-390 scored 8/10, above Alby |

## Verified defects (probed against source)

1. Stale `.cook` resolution: `pay()` uses the load-time address; a transfer or escrow listing between load and sign pays the old owner. Gemini + DeepSeek converged, different starting points. First change on both lists.
2. Aggregator swap transaction signed without inspection: no signer check, no fee-payer check, no post-simulation balance delta. Gemini.
3. Balance summed across every token account for the mint while the transfer always draws from the ATA. DeepSeek.
4. Link-carried `decimals` trusted; mint never read. DeepSeek.
5. History capped at 40 signatures, no `before` paging. Both.
6. `onSwapped` fires before the swap is confirmed. Gemini.
7. Blockhash fetched at build, not before send. Gemini.
8. Simulation copy overclaims what `sigVerify: false` proves. DeepSeek.

## Refuted

- Memo `|` injection (Gemini): `ref` is escaped, `note` takes the remainder — by design; parse is correct.
- Wrapped COOK trapped in a token account (Gemini): `isNative` covers the wrapped mint and routes to `SystemProgram.transfer`.
- Second-instruction memo false negatives in the prefilter (DeepSeek): the RPC memo summary includes every memo instruction.
- `usdToRaw` throwing on sub-unit dollar amounts (Gemini): correct behaviour with a clear error.

## Documented limitation, not a change

Forged `cookiejar:1|…` memos on dust transfers appear in history (both lanes). Rows are chain facts with an explorer link; the README says so.

## Design round 1 (applied)

Solid primary button on Pay; header wallet chip removed on /pay; jar address truncated to one mono line and Reload deleted; dashed empty-state box deleted on Create; pay ledger six rows → four (exact amount folded into the sub-headline); dashed rules → solid hairlines. Round 2 runs on the re-render with the same prompt and the recaptured references; stop when the score stalls.

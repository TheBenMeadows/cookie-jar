# Review: Cookie Jar — round 1 (code)

You are reviewing the on-chain payment library of a small web app that creates payment links and tip jars on Cookie Chain, an SVM (Solana-compatible) network. Answer as a forensic reviewer of wallet and payment code who has shipped Solana transaction builders. Be specific and concrete: name the file, function and line; give the failing input and the wrong output; no compliments; do not restate the code. Rank findings by expected impact on a user's funds or on a payment silently going to the wrong place. Under 800 words.

## The target

A creator makes a request (recipient address or `.cook` name, token mint or native COOK, fixed amount in token units or in USD quoted at open time, or open amount; label, note, reference). The request is base64url-encoded into the URL fragment; nothing is stored server-side. The payer's page decodes it, resolves the `.cook` name on chain, quotes USD via the Cookiescan registry, builds ONE transaction (SystemProgram transfer for native COOK, or an SPL/Token-2022 transfer that creates the recipient's associated token account in the same transaction when missing) with a memo `cookiejar:1|<reference>|<label>`, simulates it, then hands it to the connected wallet to sign and send. A payer holding a different token can first swap through the Cookiebox or Candy Shop aggregator (`POST /swap-tx`, `POST /swap-tx/multi-route`), which return an unsigned v0 transaction with the payer as fee payer. Jar history is reconstructed from `getSignaturesForAddress` plus memo parsing.

Chain facts: RPC `https://rpc.cookiescan.io`, solana-core 4.1.2; native token COOK, 9 decimals, wrapped mint `So11111111111111111111111111111111111111112`; fee 0.000005 COOK per signature. Name service: CookOven `.cook` names, PDA-derived registry accounts; a registered name can be listed for sale (escrowed), in which case paying it must be refused.

## What is settled and not under review

The UI, the design, the choice of hash routing, the decision to have no backend.

## Attached from our side

The files under `src/lib/` listed below are the unit under review, in dependency order: `chain.ts` (connection), `request.ts` (request model, validation, encode/decode, memo format), `domains.ts` (`.cook` resolution and escrow detection), `tokens.ts` and `quote.ts` (registry lookups, USD → raw amount), `balances.ts`, `pay.ts` (transaction build + simulate + send), `swap.ts` (aggregator quote and swap-tx), `history.ts` (jar reconstruction), and `src/pages/Pay.tsx` (the only caller that orders these steps).

## Questions

1. **Wrong-recipient paths** — every way a payment can be built for an address other than the one the creator encoded: name-resolution races, decode ambiguity, memo/label injection into the link, unicode or case handling in names, a stale resolution between quote and sign.
2. **Amount arithmetic** — decimals, BigInt/Number boundaries, USD quoting at open time, rounding for display versus the raw amount signed, open-amount validation, dust, and the maximum safe values.
3. **Transaction correctness** — ATA creation ordering, Token vs Token-2022 program selection, memo instruction placement, fee payer, blockhash expiry versus the simulate-then-sign gap, what `simulateTransaction` with `sigVerify` off can and cannot prove.
4. **Swap step** — slippage, quote expiry, the swap transaction's fee payer and recipient, and whether the payment transaction can be sent before the swap has landed.
5. **History parsing** — false positives (a transfer carrying a look-alike memo), false negatives, pagination limits, and what happens on a recipient with thousands of signatures.
6. **The single change you would make first**, with the code.

Do not edit any files.

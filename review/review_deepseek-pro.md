# Cookie Jar — code review

Ranked by expected impact on funds or on a payment going to the wrong address.

## 1. Stale name resolution sends to the old owner (wrong recipient)
`Pay.tsx` — the resolve `useEffect` and the `pay` callback. `resolveRecipient` runs once at page load and caches `resolved.address` in state; `pay()` builds the transaction against that cached address. The documented contract is "names resolve at pay time," but nothing re-resolves at pay time. If the `.cook` name is transferred — or listed for sale, moving it into the escrow PDA — between load and sign, the payer signs a transfer to the pre-transfer owner. The escrow check in `domains.ts:resolveRecipient` runs only at load, so a name listed after load still pays the previous owner. This is the one path that silently moves funds to the wrong key.

Failing input: payer opens `alice.cook`, waits, Alice lists the name (owner → `escrowAuthorityPda`), payer signs. Wrong output: native COOK to Alice's old wallet, not refused.

## 2. Transfer source is always the ATA, but the balance is summed over all accounts
`pay.ts:buildPayment` sets `source = getAssociatedTokenAddressSync(mint, payer, true, tokenProgramId)`; `balances.ts:fetchBalanceOf` sums every token account the wallet holds for that mint. A payer whose funds sit in a legacy (non-ATA) token account is shown a sufficient balance and the shortfall gate passes, but the transaction transfers from an uninitialized ATA and fails on chain. `buildPayment` creates the destination ATA but never checks or funds the source. The "You hold" row lies to the payer.

Failing input: wallet holds 5 COOK-mint tokens in a legacy account, ATA empty. Wrong output: UI shows "you hold 5", button enabled, simulate fails "insufficient lamports" / uninitialized account.

## 3. Jar history accepts any transfer carrying the prefix (false positives, inflated totals)
`request.ts:parseMemo` and `history.ts:fetchJarHistory` accept any memo starting `cookiejar:1|`. The memo carries no recipient address and no amount, so anyone can send a 1-lamport transfer to the jar with a forged `cookiejar:1|ref|note` and it is counted as a payment — polluting `totalsByToken` and the receipt list. There is no way to distinguish a real jar payment from a spoofed one, and the app cannot even tell whether the memo's sender is the transfer's sender.

Failing input: attacker sends 0.000001 COOK to a popular jar with memo `cookiejar:1|fake|tip`. Wrong output: a bogus payment row in the creator's history.

## 4. History is truncated at 40 and pre-filtered on the RPC memo summary
`history.ts:fetchJarHistory` calls `getSignaturesForAddress(jar, { limit })` with no `before` cursor, so a jar with thousands of signatures shows at most 40, oldest-first-chunk, with no pagination. The candidate filter also drops transactions when `s.memo` is present but not the jar memo — `getSignaturesForAddress`'s `memo` field is the first/whole-tx memo summary, so a payment whose jar memo is the second instruction can be silently excluded (false negative).

## 5. Link-carried `decimals` drives both display and the checked transfer
`request.ts:tokenDecimals` and `pay.ts:buildPayment` trust `request.decimals` from the fragment. `fetchTokenProgramId` reads the mint account but never reads its actual decimals. A link whose `decimals` disagree with the mint shows a wrong amount to the payer (the UI formats with the link value) and produces a transaction that fails on chain with `MismatchedDecimals`. Not silent theft, but a misleading display plus a payment that can't land.

## 6. `simulatePayment` overclaims what sigVerify-off proves
`pay.ts:simulatePayment` asserts "insufficient funds ⇒ every other part is valid." With `sigVerify` off, the sim skips signature checks and other state checks, so an insufficient-funds result can mask a bad signer, bad program, or rent shortfall. The message pushed to the payer ("just needs funds") overstates confidence.

## Minor
`swap.ts:bestSwapQuote` does `BigInt(q.outAmount)` on aggregator strings — a non-integer (`"1.5"`) throws and rejects the whole best-quote call. `history.ts:fetchJarHistory` sets token `symbol: ""` for every non-native receipt.

## First change: re-resolve at pay time

Close the stale-resolution window in `Pay.tsx:pay` — re-resolve immediately before building and refuse if the address changed:

```ts
const fresh = await resolveRecipient(connection, request.to);
if (!fresh.address.equals(resolved.address)) {
  throw new Error("the recipient changed while you were looking — check the address and pay again");
}
const built = await buildPayment({
  connection,
  payer: publicKey,
  recipient: fresh.address, // not the cached resolved.address
  rawAmount,
  mint: request.mint,
  decimals,
  memo: buildMemo(request),
});
```

This re-runs the escrow check too, so a name listed for sale after load is refused rather than paid into escrow.

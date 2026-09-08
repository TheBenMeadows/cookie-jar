### 1. Wrong-recipient paths

* **Stale resolution race condition & TOCTOU (High Impact)**
  * **File/Function/Lines:** [`src/pages/Pay.tsx`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/pages/Pay.tsx#L72-L98) (`useEffect` on `payload`), [`src/pages/Pay.tsx`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/pages/Pay.tsx#L150-L189) (`pay`).
  * **Failing Input:** Payer opens link for `alice.cook`. `alice.cook` owner transfers or sells the domain after initial page load, or `resolved.address` was fetched minutes/hours prior. Payer clicks **Pay**.
  * **Wrong Output:** `pay()` uses `resolved.address` stored in state at load time without re-resolving `request.to` at execution time. Payment is sent to the old owner's address.

* **Memo separator injection breaking memo structure (Medium Impact)**
  * **File/Function/Lines:** [`src/lib/request.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/request.ts#L227-L231) (`buildMemo`).
  * **Failing Input:** `request.ref = "INV123"`, `request.note = "foo|bar"`.
  * **Wrong Output:** `buildMemo` outputs `cookiejar:1|INV123|foo|bar`. When parsed by [`parseMemo`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/request.ts#L239-L248), `rest.indexOf("|")` finds the first `|` inside `note`, setting `ref = "INV123"` and `note = "foo|bar"`. But if `ref` contains `|`, line 228 replaces `|` with `/`, while `note` does not replace `|`.

---

### 2. Amount arithmetic

* **Precision loss in `usdToRaw` & zero-amount transfer risk (High Impact)**
  * **File/Function/Lines:** [`src/lib/quote.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/quote.ts#L15-L27) (`usdToRaw`).
  * **Failing Input:** `usd = "0.01"`, `priceUsd = 1000000` (e.g. BTC equivalent), `decimals = 2`. `scaledUsd = 10000000000n`. `scaledPrice = 1000000000000000000n`.
  * **Wrong Output:** `(scaledUsd * 10^2) / scaledPrice` = `1000000000000n / 1000000000000000000n = 0n`. Throws `QuoteError`, blocking legitimate payments when dollar amounts evaluate below integer base units.

* **Unbounded Open-Amount Input (Medium Impact)**
  * **File/Function/Lines:** [`src/pages/Pay.tsx`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/pages/Pay.tsx#L124-L128), [`src/lib/format.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/format.ts).
  * **Failing Input:** User types string with more decimal places than token decimal scale in open amount input (e.g., `0.0000000001` for a 9-decimal token).
  * **Wrong Output:** `uiToRaw` throws or truncates silently, setting `rawAmount = null`, disabling button without showing a helpful validation error.

---

### 3. Transaction correctness

* **Recipient Token Account creation check race & missing WSOL handling (High Impact)**
  * **File/Function/Lines:** [`src/lib/pay.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/pay.ts#L109-L121) (`buildPayment`).
  * **Failing Input:** `mint` is wrapped COOK (`So11111111111111111111111111111111111111112`) or recipient ATA is created by another entity in the gap between `getAccountInfo` and transaction execution.
  * **Wrong Output:** If recipient ATA is created after `getAccountInfo` returns `null`, `createAssociatedTokenAccountIdempotentInstruction` succeeds, but if `createAssociatedTokenAccountInstruction` were used it would fail. However, for WSOL, direct SPL transfer without unwrapping or handling native lamports leaves funds trapped in token account if recipient expected native COOK.

* **Blockhash expiration during wallet sign flow (Medium Impact)**
  * **File/Function/Lines:** [`src/lib/pay.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/pay.ts#L140-L149) (`buildPayment`), [`src/pages/Pay.tsx`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/pages/Pay.tsx#L169-L177) (`pay`).
  * **Failing Input:** `buildPayment` gets `recentBlockhash`. Payer takes >60s to approve prompt in wallet extension.
  * **Wrong Output:** Transaction submitted with expired blockhash; `sendTransaction` fails on-chain / RPC rejection.

---

### 4. Swap step

* **Unverified Swap Output Recipient & Token Misdirection (Critical Impact)**
  * **File/Function/Lines:** [`src/lib/swap.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/swap.ts#L212-L248) (`buildCookieboxSwap`, `buildCandyShopSwap`).
  * **Failing Input:** Malicious or compromised aggregator API returns a v0 swap transaction that swaps `inputMint` but sets the destination token account/recipient of the output tokens to an attacker address instead of the payer's ATA.
  * **Wrong Output:** Cookie Jar passes `transactionBase64` directly to wallet to sign without deserializing and inspecting instructions. Swapped funds land in attacker wallet; payment step subsequently fails due to missing balance.

* **Executing Payment Before Swap Confirm (High Impact)**
  * **File/Function/Lines:** [`src/pages/Pay.tsx`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/pages/Pay.tsx#L358-L366).
  * **Failing Input:** Payer completes swap via `SwapPanel`. Swap tx is sent, but block is re-orged or swap takes 5+ seconds to finalize. Payer immediately clicks `Pay`.
  * **Wrong Output:** `fetchBalanceOf` ran before swap landed; `pay()` fails during simulation/execution with `insufficientFunds`.

---

### 5. History parsing

* **History Parsing False Positives via Token Balance Deltas (High Impact)**
  * **File/Function/Lines:** [`src/lib/history.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/history.ts#L76-L92) (`tokensReceived`), [`src/lib/history.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/history.ts#L109-L111).
  * **Failing Input:** Attacker sends a transaction containing a valid `cookiejar:1|...` memo instruction targeting `jarAddress`, but transfers 0 tokens to `jarAddress` while an unrelated inner instruction or multi-transfer in the same transaction credits `jarAddress` with tokens. Or, `candidates` filter in line 109 checks `s.memo.includes(MEMO_PREFIX)`.
  * **Wrong Output:** Any transaction carrying `cookiejar:1` memo (even if memo was attached to a 0-value system transfer) will attribute ALL token balance increases of `jarAddress` in that transaction as a Cookie Jar payment.

* **Pagination Cut-off & Missing Payments (Medium Impact)**
  * **File/Function/Lines:** [`src/lib/history.ts`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/lib/history.ts#L108-L111) (`fetchJarHistory`).
  * **Failing Input:** Jar address has >40 total transactions (e.g. spam, non-CookieJar transfers, or self-transfers).
  * **Wrong Output:** `getSignaturesForAddress` fetches only first 40 signatures. Non-matching signatures consume the limit; valid Cookie Jar payments beyond the top 40 are permanently hidden.

---

### 6. The single change you would make first

Re-resolve the recipient address immediately before building and simulating the payment inside `pay()` in [`src/pages/Pay.tsx`](file:///Users/bemeadows/Projects/superteam-sept26/cookie-jar/src/pages/Pay.tsx#L150-L164) to prevent paying a stale or hijacked recipient address.

```typescript
// In src/pages/Pay.tsx around line 155:
const pay = useCallback(async () => {
  if (!request || !publicKey || rawAmount === null) return;
  setError(null);
  setWarning(null);
  setStage("sending");
  try {
    // Re-resolve domain right before building tx to prevent TOCTOU / domain ownership change races
    const freshResolved = await resolveRecipient(connection, request.to);
    setResolved(freshResolved);

    const built = await buildPayment({
      connection,
      payer: publicKey,
      recipient: freshResolved.address,
      rawAmount,
      mint: request.mint,
      decimals,
      memo: buildMemo(request),
    });
    // ... proceed with simulation and sendTransaction
```

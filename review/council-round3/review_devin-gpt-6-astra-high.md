## Findings, ranked by expected impact

### 1. Successful checkout does not land on the chain-rebuilt receipt

`onPaid` only sets local signature/stage. The success screen renders the amount from request state; its reference-specific receipt is a **read-only input plus Copy**, not a navigable link. The only history link opens the unfiltered jar, where transaction shapes are not displayed. Thus even the successful judge path misses the stated destination. Navigate to the receipt after confirmation, or make “Open on-chain receipt” the primary action. [Pay.tsx:331-334](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Pay.tsx) [Pay.tsx:410-488](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Pay.tsx)

### 2. The homepage invents an age explanation for an incomplete search

Home searches **ten payment rows across the jar**, then filters for `LANDING-COMPOSED`, discarding coverage information. Ten newer `TAB-…` payments can therefore produce “older than what the public RPC still holds” while the showcase transaction remains minutes old and retrievable. Hitting the scan cap, or encountering unreturned transactions during history parsing, can produce the same false explanation. The linked Jar searches fifty rows and could immediately contradict “its receipt reads ‘no record’.”

Say “No matching showcase payment was found in the history read,” with the applicable limit. This is a new presentation error, not a reason to redesign the settled reconciliation states. Also, “last payment … here” actually means last matching showcase-reference payment, not the latest visitor payment. [Home.tsx:59-74](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Home.tsx) [Home.tsx:113-123](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Home.tsx)

### 3. The advertised COOK path first presents a refusal; some requested failure behavior is unverifiable

The decoded fixed amount remains 700 TRASHCOIN when its registry price is missing: `rawAmount` uses `request.amount`; only the dollar display disappears. This establishes that **Pay itself** does not require the price—not that downstream quoting succeeds. [Pay.tsx:108-115](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Pay.tsx) [Pay.tsx:163-174](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Pay.tsx)

After connecting a COOK-only wallet and reading its balance, the primary button becomes disabled: “You need more TRASHCOIN than this wallet holds.” The actual swap action is farther below, in `SwapPanel`. A judge can interpret the primary control as the end of the path. Sufficient spendable TRASHCOIN instead bypasses swapping entirely. Native COOK fees remain necessary. [Pay.tsx:226-232](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Pay.tsx) [Pay.tsx:649-685](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Pay.tsx)

Router disagreement and exceeding 1,232 bytes are delegated outside this supplied implementation. Attempts to read `SwapPanel` and `checkout` at the original source paths failed; **neither the exact warning nor fallback/signature count can be verified here**.

**Cut:** “from whatever you hold” from the homepage heading. It promises universal spendability without stating route availability or native-fee requirements. [Home.tsx:88-93](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Home.tsx)

### 4. “Swap through” asserts semantics that the extractor never establishes

`venues` means non-housekeeping **top-level program IDs**. A CPI router appears instead of its underlying venues; an unrelated program also qualifies without performing any swap. Use “additional top-level programs,” and label the instruction count “top-level.” A signature count is an on-chain property, not proof of how many wallet prompts occurred.

Lookup tables are **not** a defect here: parsed v0 instructions already expose resolved `programId`s. An inner-only memo makes `hasMemo` false despite history accepting that memo; the implementation matches its top-level-only documentation, but `hasTopLevelMemo` would avoid misuse. [txdetail.ts:35-85](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/txdetail.ts) [TxShape.tsx:13-18](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/TxShape.tsx)

### 5. Receipt presentation conflates credits and obscures unavailable detail

Two assets in one transaction produce two rows. Detail fetching deduplicates signatures, but rendering repeats “one signature,” while the summary calls them “2 payments.” Prefer “two asset credits in one transaction.”

If history already parsed the payment but the subsequent detail fetch returns null or throws, retaining payment evidence is justified; silently omitting shape hides the failed read. Display “Transaction detail unavailable.” If the initial history fetch cannot return the transaction, it creates no payment row at all. [Jar.tsx:147-166](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Jar.tsx) [Jar.tsx:260-282](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/Jar.tsx)

The effects’ `live` guards prevent obsolete completions. Stale `details` survives reference changes, but lookup by immutable signature prevents unrelated receipts inheriting another transaction’s shape. That is not evidence of cross-reference corruption.

### 6. References are probabilistically distinct, not unique or private

The 32-character alphabet gives unbiased modulo mapping and **30 bits** of entropy. Collision risk is negligible for thirteen visitors, but approximately 4.55% across 10,000 generated references. Collisions merge reference-matched receipts and can trigger already-paid warnings. “No earlier payer has used” is unsupported.

Public references confer no spending authority or payer identity; copied links deliberately share a receipt namespace. `getRandomValues` is widely available, including insecure contexts, but not guaranteed in every older browser/webview capable of rendering React. Its unchecked absence throws directly from Pay’s click handler. [showcase.ts:34-53](file:///Users/bemeadows/Projects/.lanes/council-cookie-tab-home-invoice-180108-22390/showcase.ts)

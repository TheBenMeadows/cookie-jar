### 1. High Impact: State Leakage and Duplicate TxShape Rendering in `Jar.tsx`

* **Stale State Leak on Navigation** ([Jar.tsx:56](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Jar.tsx#L56), [Jar.tsx:144-175](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Jar.tsx#L144-L175)): `details` state is never cleared when `refFilter` changes or is removed (`if (!payments || !refFilter) return`). Navigating from a specific receipt (`?ref=TAB-123`) back to the main jar view leaves stale transaction details in memory. Any matching transaction signatures in the full jar list will erroneously render `<TxShape>` elements despite no reference filter being active.
* **Duplicate Render on Multi-Asset Receipts** ([Jar.tsx:275-279](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Jar.tsx#L275-L279)): If a payment containing multiple assets lands in a single transaction, `paymentsForRef` produces multiple `JarPayment` entries sharing the same `signature`. Because `details[p.signature]` is evaluated inside the `payments.map` loop, the exact same `<TxShape>` block is duplicated under every asset row.

---

### 2. High Impact: CPI Invisibility and Inaccurate Labels in `summarizeTransaction`

* **CPI Venue Blindness** ([txdetail.ts:504-516](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/lib/txdetail.ts#L504-L516)): `summarizeTransaction` filters `venues` by iterating strictly over top-level instructions (`tx.transaction.message.instructions`). Routers like Jupiter or custom aggregators invoke DEX pools (e.g., Raydium, Orca) via Cross-Program Invocations (CPI), which land in `tx.meta.innerInstructions`. `venues` only captures the top-level aggregator program ID and completely omits the actual execution venues.
* **Inner Memo Blindness** ([txdetail.ts:507-509](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/lib/txdetail.ts#L507-L509)): `hasMemo` only evaluates to `true` if the memo program ID is present at the top level. Memos emitted via CPI inside program calls are flagged as `hasMemo: false`.
* **Misleading UI Copy** ([TxShape.tsx:17-23](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/components/TxShape.tsx#L17-L23)): Rendering `"swap through <address>"` using an unmapped base58 address displays raw pubkeys (e.g., `cpamdp...`) rather than recognizable venue names, misrepresenting an aggregator router address as the underlying venue.

---

### 3. Medium Impact: False RPC Window Explanation in `Home.tsx`

* **Misleading No-Record Diagnosis** ([Home.tsx:634](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Home.tsx#L634), [Home.tsx:691-696](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Home.tsx#L691-L696)): `Showcase` fetches history with a hardcoded scan limit of 10 (`fetchJarHistory(..., 10)`). If 10 newer transactions occur on the demo jar, `paymentsForRef` returns empty, triggering `kind: "none"`. `ProofLine` then reports that the payment is *"older than what the public RPC still holds, about ten days"*, even if the payment occurred minutes ago.

---

### 4. Medium Impact: Silent Bypassing of Swap-and-Pay on Judge Path

* **Hidden Feature when Shortfall is Zero** ([Pay.tsx:188-191](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Pay.tsx#L188-L191), [Pay.tsx:675-685](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Pay.tsx#L675-L685)): `SwapPanel` only renders when `shortfall !== null`. If a judge's wallet already holds $\ge 700$ TRASHCOIN, `shortfall` is `null`. The judge is routed to a standard SPL transfer, silently bypassing the single-transaction swap-and-pay path without warning that their existing balance disabled the demo feature.
* **Composed Tx Size Limit**: A combined transaction (Compute Budget + ATA Creation + Router Swap + SPL Transfer + Memo) risk exceeding Solana's 1,232-byte MTU limit if multi-hop swap routes or extra account keys are required, causing silent simulation or signing failures.

---

### 5. Low Impact: Reference Generation & Link Analysis

* **Entropy & Uniformity** ([showcase.ts:311-313](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/lib/showcase.ts#L311-L313), [showcase.ts:341-349](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/lib/showcase.ts#L341-L349)): `freshRef` draws 6 bytes using `crypto.getRandomValues`. Because $|\text{REF\_ALPHABET}| = 32$ divides 256 evenly ($256 \pmod{32} = 0$), `byte % 32` has zero modulo bias. 6 characters yield $32^6 = 2^{30} \approx 1.07 \times 10^9$ unique references, making random collision impossible in practice. `globalThis.crypto.getRandomValues` is supported in all target secure contexts.
* **Public Link Front-Running**: References travel unencrypted in hash URLs (`#/pay/...`) and on-chain memos. Anyone watching the chain can broadcast a 1-lamport payment using a target reference before the real payer. While `settlementOf` sums matching mint balances, partial front-running payments alter state to `partial`.

---

### 6. Unearned Copy to Cut

* **Delete [Home.tsx:691-696](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Home.tsx#L691-L696)**:
  ```tsx
  The last payment that landed here is older than what the public RPC still holds, about ten days, so its receipt reads "no record" rather than guessing.
  ```
  **Reason**: Unearned diagnosis. The query fetches only the 10 most recent signatures ([Home.tsx:634](file:///Users/bemeadows/Projects/.lanes/cookie-tab-home-invoice/src/pages/Home.tsx#L634)). Attribute-based statements claiming data is $>10$ days old are factually false when the fetch simply hit the 10-item cap.

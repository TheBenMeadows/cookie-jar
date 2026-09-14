## Findings, ranked by expected impact

### 1. High: the homepage advertises a one-signature path that is not guaranteed

`Home.tsx:90-93` says the page “quotes both Cookie Chain routers” and puts the swap, transfer, and memo “behind one signature.” That is only true if the quote succeeds, a router can build a transaction within the protocol’s serialized transaction-size limit, simulation succeeds, and the connected wallet can sign the resulting transaction.

`Pay.tsx:675-684` delegates the composed path to `SwapPanel`, while `Pay.tsx:251-263` and the swap implementation perform simulation only after the user reaches the payment page. There is no visible homepage qualification for unavailable liquidity, router disagreement, an oversized transaction, or a wallet that cannot sign. An oversized composed transaction therefore fails after the judge has followed the primary path, rather than being excluded or explained before signing.

The claim should be reduced to “attempts a one-transaction swap-and-pay” unless `SwapPanel` explicitly guarantees a fallback and checks the serialized size before presenting the action.

### 2. High: `Home.tsx` treats an incomplete ten-entry scan as proof that the prior landing is old

`Home.tsx:62-66` calls `fetchJarHistory(..., 10)` and, when no `LANDING-COMPOSED` payment is returned, immediately renders the “older than what the public RPC still holds” explanation at `Home.tsx:119-123`.

That conclusion does not follow from the result. The scan can terminate because of the history scan cap or another coverage boundary before reaching the known reference. `Jar.tsx` correctly computes `readToTheEnd` with `coversAbsence` at lines 228-230, but `Home.tsx` ignores the returned coverage fields entirely. A busy demo jar can therefore display a false retention explanation even while the target payment remains in the node’s searchable history.

The homepage needs the same coverage-aware distinction as the receipt page: confirmed absent, not found within a capped scan, and RPC unreadable.

### 3. High: “swap through” misidentifies routers as swap venues

`txdetail.ts:51-60` defines `venues` as every non-housekeeping top-level program ID. `TxShape.tsx:182-190` then labels those IDs “swap through.”

On a composed transaction whose router invokes pools or venues through CPI, the top-level ID is the router, not the venue that executed the liquidity operation. The rendered text is therefore not an independently valid claim about the swap venue. Conversely, if a transaction invokes only a router at the top level and the actual venue is inner-only, `venues` contains no venue at all. Any other application program in a transaction is also classified as a venue unless it happens to be in the housekeeping set.

Address lookup tables do not create this particular error; parsed instructions still expose their resolved program IDs. They also do not make the classification semantically reliable. The line should say “top-level non-system programs” or “top-level programs,” not “swap through.” If venue identification matters, it requires protocol-specific instruction and inner-instruction decoding.

### 4. Medium: a missing transaction detail is silently presented as a complete proof

When history contains a matching payment but `getParsedTransaction` returns `null`, `Home.tsx:641-643` stores `{ detail: null }` and `Home.tsx:707-717` renders only the timestamp, receipt link, and explorer link. `Jar.tsx:278-282` similarly renders no explanation when `details[p.signature]` is `null`.

The payment itself is still supported by the jar-history record, but the promised transaction shape is unavailable. The UI should explicitly say that the transaction landed but its instruction/signature detail is no longer available from this RPC. Otherwise the absence of the shape looks like an implementation omission rather than a retention limitation.

### 5. Medium: the receipt shape is duplicated for two asset rows

`Jar.tsx:267-282` renders one row per `(signature, mint)` but attaches the same signature-keyed `TxDetail` to every row. A composed payment carrying two assets consequently shows the identical transaction shape twice. That is not factually wrong, but it implies two separately described transactions and obscures the important relationship: two payment records, one transaction.

The shape should be rendered once per distinct signature, or the row should state that the shape is shared with another asset row.

### 6. Medium: the payment button is enabled while the payer balance is unknown

`Pay.tsx:226-231` blocks for a missing recipient, amount, or known shortfall, but does not block when `holding` is `null`. A connected COOK-only wallet can therefore press the direct payment button while the balance request is still pending or has failed. `Pay.tsx:234-236` then proceeds without a holding check, and the transaction eventually fails simulation or wallet submission instead of showing the swap path.

The button should remain disabled, with a distinct “Reading wallet balance” or “Balance unavailable” state, until the holding read completes. This is especially relevant to the stated judge path.

### 7. Low: the reference is non-secret and has a real collision probability

`showcase.ts:311-328` uses `crypto.getRandomValues`, and modulo reduction is unbiased here because the alphabet has 32 symbols and one byte has 256 values. Six characters provide $32^6 = 1,073,741,824$ possible references, which is ample for ordinary judging but not uniqueness by construction. The birthday collision probability reaches approximately 50% around 38,600 generated references.

More importantly, the reference is public link data and memo data. `Jar.tsx:260-264` correctly acknowledges that anyone can put the text in a memo, so “your receipt is yours” at `Home.tsx:100-101` is overstated. The reference identifies a receipt; it is neither an authorization token nor proof that the payer who generated it made the payment. `crypto.getRandomValues` is available in modern browsers, but this code has no fallback for browsers without Web Crypto; the supported-browser target is not stated.

### 8. Low: the fixed price claim can age out

`Home.tsx:99-101` says 700 TRASHCOIN is “about half a dollar,” while `showcase.ts:293-294` hard-codes the amount and deliberately avoids a price read. The token’s market price can change independently of the deployed bundle. That sentence is not durable homepage copy.

## Cut

Delete `TxShape.tsx:184-185`’s phrase `swap through`. The code proves only that one or more non-housekeeping programs appeared at the top level. It does not prove that those programs were liquidity venues, and in the router-CPI case it names the router instead of the venue.

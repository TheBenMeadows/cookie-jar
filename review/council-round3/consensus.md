# Round 3: 5 lanes on Cookie Tab PR #23, the homepage live invoice (2026-09-13)

Lanes asked, and what each could see:

| Lane | Route | Saw | Result |
|---|---|---|---|
| Gemini 3.9 | `agyx` | diff + sources | `review_gemini-agyx.md` (5.8 KB): the ten-row "none" state; duplicate shape on two-asset rows |
| GPT-5.6 Luna | Kagi `gpt-5-6-luna` | diff + sources | `review_gpt-5-6-luna.md` (9.2 KB): same two, plus the Pay button enabled while the balance is unread |
| GPT-6 Astra (high) | Devin | diff + sources (Pay.tsx included) | `review_devin-gpt-6-astra-high.md` (6.6 KB): the paid screen never links the receipt; a short wallet sees a refusal above the swap panel |
| DeepSeek V4.1 Flash | `ccx deepseek-flash` | diff + sources | `review_deepseek-flash.md` (6.3 KB): the "none" copy also predicts the receipt's wording; six-character birthday arithmetic |
| SWE-2 (high) | Devin | diff + sources | `review_devin-swe-2-high.md` (5.8 KB): proof reads the key while the invoice pays the name |
| Codex via ccx | `gpt-5.6-terra` | — | not seated: 429 `usage_limit_reached` on the ChatGPT free plan at launch |

All five replies landed within eight minutes; none was empty or truncated.

---

## A. Verified defects (measured here, not claimed)

**A1 — The homepage proof asserted a cause it never measured.** *All five lanes.* `Home.tsx` read ten payments (`fetchJarHistory(…, 10)`), filtered for `LANDING-COMPOSED`, and on an empty match printed "older than what the public RPC still holds, about ten days". Ten newer payments, which is what the homepage invoice invites, make that sentence false about a payment minutes old, while the linked receipt reads fifty and says "Paid". Confirmed by reading `history.ts`: `stoppedAtLimit = read < ordered.length` is true in exactly that case and the page ignored it. Fixed: the proof resolves the name, reads 50 like the receipt page, and splits the empty case with `coversAbsence` into `absent` and `unread`, each with a sentence that says what the read did.

**A2 — "swap through" named an invoked program a venue.** *All five lanes.* `venues` was every non-housekeeping top-level program id. Probe (`getParsedTransaction` on 3R1C9BBU…, inner groups listed): the top-level program `cpamdp…` has inner calls only to the token program and to itself, so on this chain it IS the venue and the label was true. On any route where a router CPIs venues the label would have named the router and dropped the venues. Fixed: `programs`, collected from the top level and every inner group in first-appearance order; the line says "through", the docs say what it measures; `hasMemo` reads inner memos as `history.ts` does.

**A3 — Two-asset receipts wrote the shape twice.** *Gemini, Luna, Astra, DeepSeek.* `matching.map` rendered `TxShape` per `(signature, mint)` row. Fixed: once, on the transaction's first row; and a transaction the RPC lists but will not return now says so instead of rendering nothing (*Luna, Astra, DeepSeek, SWE-2*).

**A4 — The paid screen never linked the receipt.** *Astra.* Confirmed by reading `Pay.tsx` 466–488: a read-only input plus Copy, and the only link opened the unfiltered jar. Fixed: "Open the receipt" as a primary link.

**A5 — A wallet short of the token saw a refusal above the path.** *Astra, SWE-2, Luna.* Confirmed: `payBlocker` returned "You need more TRASHCOIN than this wallet holds" with the swap panel below it. Fixed: "Short of TRASHCOIN: swap and pay below, in one transaction". *Luna* also found the button enabled while `holding === null`; fixed with a "Reading this wallet's balance…" blocker.

**A6 — Six characters was one too few for a shared namespace.** *DeepSeek, Astra, Luna.* 32⁶ ≈ 1.07e9; the odds of two visitors sharing a receipt reach ~4.6% at ten thousand presses on one jar. Fixed: seven characters (35 bits, under 0.2% at the same traffic). The modulo is unbiased (256 = 8 × 32); every lane agreed.

**A7 — The proof read the key while the invoice pays the name.** *SWE-2.* Confirmed by reading: `SHOWCASE_JAR` vs `showcaseRequest().to = SHOWCASE_NAME`; the Pay page re-resolves the name for the same reason. Fixed: the proof resolves the name first.

**Exonerated:**
- Stale `details` rendering under the wrong reference (*Gemini*): the shape is only rendered inside the `refFilter` block and looked up by immutable signature, so nothing false could render (*Astra and SWE-2 said the same*). Cleared on each read anyway.
- Address lookup tables (*brief's own question*): parsed v0 instructions carry resolved `programId`s (*Luna, Astra, DeepSeek*).
- `crypto.getRandomValues` needs no secure context (*DeepSeek, SWE-2*); a wallet-capable browser has it. No fallback added.
- Front-running a public reference with a 1-lamport payment (*Gemini*): already documented in the README and on the receipt; the reference is disambiguation, not authority.

**Inconclusive:** none. The composed-transaction size limit and router disagreement were out of the supplied sources (*Astra said so*); the README already documents the swap-first fallback and the copy now says it.

## B. Where the lanes converge

**B1 — Cut the unearned copy.** 4 of 5 on "about half a dollar" (the one number the page does not read; the Pay page reads the live price and showed $0.49). 3 of 5 on "so your receipt is yours" (a reference is public text). Astra alone on "from whatever you hold" in the heading; kept, with the lede now saying what happens when the route does not fit one transaction and when the payer already holds the token.

**B2 — The judge's path is the Pay page, not the homepage.** Astra and SWE-2 both traced it and found the two stalls in A4/A5; the homepage was fine. Shared prior or truth: truth, confirmed by reading.

### Tensions to resolve

None left open. Gemini's "CPI blindness" and Luna's "top-level only" prescriptions differ in form (scan inner groups vs relabel); both applied.

## C. Performance

The proof now costs one name resolution and a 50-payment read instead of a 10-payment read; the receipt page already paid that. Nothing else changed.

## D. What each lane got wrong

- *Gemini*: claimed stale `details` would render `TxShape` in the unfiltered list; it cannot. Line numbers were offset by ~500 (read the concatenated brief).
- *Luna*: 40% of its bytes were a visible thinking block. Findings were sound.
- *Astra*: could not read `SwapPanel`/`checkout` (not supplied) and said so rather than guessing. Best correctness pass of the round.
- *DeepSeek*: said the top-level program "is the router"; the probe shows it is the CP-AMM. The prescription (scan inner groups) was right anyway.
- *SWE-2*: "instruction count inflated by housekeeping" is a framing choice, not a defect; the count is labelled as top-level.

## E. Order of work

All applied in one branch, `fix/council-round3`: A1–A7 and B1. 145 unit / 26 live green. Nothing deferred.

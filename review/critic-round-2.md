# Cookie Jar — visual critique, round 2

Screenshots only. All four references rendered; none was blank or a block page. The Stripe capture includes the docs demo chrome at top and bottom (a "Prebuilt form" selector and a Features/Style/Country bar) — those are the harness, not the payment form, and were excluded from its score.

## 1. Ranked by polish

| # | Screen | Score | Reason |
|---|---|---|---|
| 1 | refs/stripe-390 | 9 | Dense rows, exact rhythm, zero waste |
| 2 | pay-fixed-390 | 8 | Amount dominates; rows quiet, correctly subordinate |
| 3 | create-filled-1280 | 7 | Two columns work, misaligned tops though |
| 4 | pay-usd-390 | 7 | Three-clause subline undercuts hero number |
| 5 | refs/alby-390 | 7 | Tidy card, visible Amount0 label bug |
| 6 | jar-390 | 6.5 | Two underline styles, mixed alignment axes |
| 7 | pay-tipjar-390 | 6.5 | No hero figure, page reads flat |
| 8 | refs/paypal-390 | 6 | Brand banner fine, cookie sheet dominates |
| 9 | create-390 | 6 | Disabled button indistinguishable from empty field |
| 10 | pay-escrowed-390 | 5.5 | Three stacked messages, one competing red |
| 11 | about-390 | 5 | Undifferentiated prose wall, wrapping hash strings |
| 12 | refs/coinos-390 | 4.5 | Enormous void, avatar and bar only |

Position: the candidate's best screen sits one notch under Stripe and above every other reference. Its median screen (6.5) sits between Alby and PayPal. The floor (about, escrowed) is below all references except Coinos.

## 2. Five highest-impact changes

**1. Make the disabled primary button read as a button.**
Shown in create-390 ("Enter a recipient to make the link"), pay-tipjar-390 ("Enter an amount"), pay-escrowed-390 ("This link's recipient does not resolve"). All three render as a 1px-bordered beige box with centred grey text — identical to the empty input fields directly above them. Give the disabled state the enabled fill: `background: #141414; color: #fff; opacity: 0.38;` and delete the border and the beige background entirely. The enabled version (create-filled-1280, pay-fixed-390) is already solid black; the disabled one must be the same object dimmed, not a different object.

**2. Delete the CREATE / HOW IT WORKS nav row and its hairline rule from all four /pay screens.**
Shown in pay-fixed-390, pay-usd-390, pay-tipjar-390, pay-escrowed-390. A payer arriving at a payment link has no use for "CREATE", and the row adds a second horizontal rule 30px under the first, so every pay screen opens with two stacked rules before any content. Stripe's checkout ships no site nav for exactly this reason. Keep the wordmark, keep the 2px black rule, delete the row below it.

**3. Delete the over-precise machine strings.**
Two places. In pay-usd-390, the subline reads `$25.00 at $0.00009130 per COOK · exactly 273,827.349709201 COOK` and wraps to two lines directly under a 273,827 hero — the same number twice, the second time to twelve decimals, which reads as a contradiction. Delete the `· exactly 273,827.349709201 COOK` clause. In about-390, the "What this app touches" block prints full base58 keys (`So111…112`, `MemoSq4gq…`, `H43Qtq4AMQ86y7yc3YtCKZJ2QMhhnCcHyZKeFeoQn7PA`) that wrap and overflow at 390px; truncate each to first-6…last-6 and keep the full value on the link target only.

**4. One underline treatment, for navigation only.**
Shown in pay-fixed-390 (underlined `4GGk4vTD…GKSGUx` in the TO row), pay-usd-390 (underlined `cookie.cook`), jar-390 (an underlined truncated address immediately followed by underlined "copy the full key" in a different typeface — the two read as a single run). Delete the underline from the TO value in the detail rows on all pay screens; on jar-390 render "copy the full key" as a small bordered button matching the Copy button already on that page, not as underlined text.

**5. Cut the trust paragraph to one sentence, and delete it from the error state.**
Shown on all four pay screens: "Cookie Jar never holds the money. This page builds one transaction, your wallet signs it, and the funds go straight to the address above." — three lines of 13px grey sitting between the CTA and the footer, which itself repeats "Nothing is stored on a server." Delete sentences two and three, keep "Cookie Jar never holds the money." On pay-escrowed-390 delete the paragraph outright: that screen already carries a red warning block and a disabled-button explanation, and a third block of reassurance about a payment that cannot proceed competes with the one message that matters.

## 3. What the candidate does better

The fixed-amount pay screen states the amount, the destination, the token, the reference and the network fee in one unscrolled view with no card wrappers, no shadows and no illustration — Stripe needs an accordion to do it, and Coinos, PayPal and Alby all bury the figure under a hero image or an empty half-page.

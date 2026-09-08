Reference capture note: three of the four references are degenerate captures and should be read as such. `stripe-390.png` is roughly 70% empty grey placeholder — the page content never rendered. `cashapp-390.png` and `bmac-390.png` are both 404 pages. Only `alby-390.png` shows an actual payment surface. The candidate's rank above three of them is therefore worth very little; its rank against Alby is the only comparison that means anything.

## 1. Ranked by polish

| # | Screen | Score | Six-word reason |
|---|---|---|---|
| 1 | pay-fixed-390 | 8 | Big number, clean rows, weak button |
| 2 | create-filled-1280 | 7 | Good columns, truncated link, empty bottom |
| 3 | pay-escrowed-390 | 7 | Error copy sharp, dead ghost button |
| 4 | pay-usd-390 | 7 | Same strengths, six rows repeat themselves |
| 5 | alby-390 (ref) | 6 | Real payment page; cramped, label bug |
| 6 | create-390 | 6 | Two stacked empty states, wasted screen |
| 7 | pay-tipjar-390 | 6 | Sparse; ambiguous zero field, unstyled action |
| 8 | about-390 | 5 | Undifferentiated text wall, hashes break lines |
| 9 | jar-390 | 5 | Wrapped address, orphan button, ragged alignment |
| 10 | cashapp-390 (ref) | 5 | Competent 404; nothing to judge here |
| 11 | bmac-390 (ref) | 4 | 404 outline numeral, near-empty, floating widget |
| 12 | stripe-390 (ref) | 2 | Mostly grey void; capture largely failed |

## 2. Five highest-impact changes

**1. Make the pay CTA a real button, and delete the header wallet chip on pay routes.**
Shown in `pay-fixed-390`, `pay-usd-390`, `pay-tipjar-390`, `pay-escrowed-390`. "Connect a wallet to pay" is centred text inside a 1px tan outline on a tan ground — lower contrast than the input borders elsewhere on the same page, so the primary action reads as disabled. Give it the exact treatment already used by "Copy payment link" in `create-filled-1280`: solid near-black fill, white bold label, full column width, same height. At the same time delete the outlined "Connect wallet" chip from the header on `/pay` screens — two competing wallet affordances, one of them the page's only job.

**2. Truncate the address on the jar header and delete the Reload button.**
Shown in `jar-390`. The 44-character address wraps to two lines directly under "cookie.cook" and sets a ragged left block that nothing else on the page aligns to. Render it as `4GGk4vTD…GKSGUx`, single line, monospace — the exact form the pay screens already use. Separately, delete the "Reload" button sitting alone under the QR code: it is a browser affordance rendered as UI, and it is the only left-aligned control on a page of full-width elements.

**3. Delete the dashed empty-state box on the create form.**
Shown in `create-390`. The screen shows two empty states for the same absent object, stacked: the ghost button "Enter a recipient to make the link" and, below it, a dashed rectangle reading "The link and its QR code appear here once the form is filled." Delete the dashed rectangle entirely. The button already says what is missing.

**4. Cut the pay table from six rows to four.**
Shown in `pay-usd-390`. TO shows `cookie.cook`; ADDRESS shows the same recipient as a truncated key — delete the ADDRESS row and put the address in the title attribute of the TO value, which is already styled as a link. EXACT AMOUNT shows `273827.349709201 COOK` while the headline shows `273,827 COOK`: two amounts, twelve digits apart, both claiming to be the number. Delete the EXACT AMOUNT row and move the full precision into the sub-headline that already carries the rate, so there is one place to read the amount.

**5. Replace the dashed horizontal rule with the solid hairline used below it.**
Shown in `create-390`, `pay-fixed-390`, `pay-usd-390`, `pay-tipjar-390`, `pay-escrowed-390`. Every pay screen puts a dashed divider under the headline and then solid 1px rules between every table row two pixels of hierarchy later. The dash carries no meaning the solid rule does not; it is the only decorative stroke in an otherwise flat system. Use the same solid hairline, or delete the divider and rely on the existing vertical gap.

## 3. What the candidate does better

It states the entire transaction — recipient, token, exact amount, reference memo, and network fee — as one legible table before the payer commits, where Alby asks for a number and shows nothing about where it goes.

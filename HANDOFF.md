# Cookie Jar — what still needs Ben

Everything below is gated on Ben. Nothing here was done: no repository exists, nothing is deployed, nothing is posted, and no COOK was moved.

## 1. COOK funding

**Amount: about $2 to $5 of COOK, which is 22,000 to 55,000 COOK at $0.0000913.**

Why any at all: the app is verified against the live chain by simulation only (16 checks, `npm run live`), and simulation cannot prove a signature is accepted, a transaction lands, or the jar picks the payment up afterwards. One real payment closes that gap. The recipe is in README.md under "The funded end-to-end test".

Why so little: the network fee is 0.000005 COOK per signature. The funding is entirely the amount you want to send yourself plus the rent for one associated token account if you also test an SPL payment (about 0.002 COOK). $2 covers dozens of runs with room to spare.

Where it comes from: the Hyperlane warp route at https://bridge.cookiescan.io moves COOK from Solana mainnet. No faucet is known.

## 2. Which wallet acts

Cookie Jar never sees a key, so the only decision is which wallet signs the demo payment and therefore appears on the demo transaction the submission links.

Nightly is the bounty-endorsed wallet and the app lists it first, so a fresh Nightly wallet funded with the amount above is the clean answer. Two addresses are needed, one paying and one receiving; a second Nightly account is enough.

Open: whether Ben wants the demo payment attached to an existing identity or to a throwaway. The submission form asks for a demo transaction signature, which makes the payer address public.

## 3. GitHub repository

**Suggested name: `cookie-jar`.** Public, MIT, no organisation preference recorded.

The local repository at `/Users/bemeadows/Projects/superteam-sept26/cookie-jar` has two commits and no remote. Creating the GitHub repository and pushing is an estate mutation and needs an explicit APPROVE naming the repository.

Once the URL exists, set it in two places: `VITE_REPO_URL` at build time, and the two `[REPO URL]` placeholders in SUBMISSION.md. The default in `src/lib/config.ts` currently points at `https://github.com/TheBenMeadows/cookie-jar`, which does not exist yet.

## 4. Cloudflare Pages

**Suggested project name: `cookie-jar`. Suggested custom domain: `jar.mdws.me`.**

Build command `npm run build`, output directory `dist`, Node 22 or later. No environment variables are required; the defaults are the public Cookie Chain endpoints.

Deploying is an APPROVE-gated mutation and was not done. The DNS record for a custom domain is a second mutation.

One thing to check before the domain is chosen: `jar.mdws.me` carries Ben's own domain, which is fine for a public bounty entry but is not a cover-story surface. If this entry should not sit under `mdws.me`, the `pages.dev` subdomain works unchanged, because routing is in the URL fragment.

## 5. Fill in the placeholders

SUBMISSION.md has four: the live URL twice, the repository URL twice, and the demo transaction signature. The X thread and the Telegram line are drafts and have not been posted.

## What could not be verified

**No browser ever rendered this app.** The build is clean, 25 unit and render tests pass under jsdom, and `vite preview` serves the bundle over HTTP, but no screenshot was taken and no human eye has seen the layout. Headless Brave was tried and hung; the browser MCP was off limits for this run because it drives Ben's live browser. The design was written to a plain rule set (one accent colour, hard rules, tabular figures, no gradients or shadows) and the visual result is unconfirmed.

**No wallet ever connected.** `WalletBar` and the wallet-adapter path are exercised only to the point of rendering. Whether Nightly appears first in the picker, whether `autoConnect` behaves, and whether `sendTransaction` returns what the Pay page expects are all unconfirmed until step 1 above happens.

**No transaction was ever signed or sent.** Every transaction check is `simulateTransaction` with signature verification off. That proves the instruction data, the accounts and the programs are right. It does not prove a wallet signs it, a validator accepts it, or the jar reads it back.

**No swap was ever executed.** Both aggregators build a swap transaction that simulates clean for a real holder, which is strong evidence the route works. Signing and sending one is untested.

**No jar has any history yet.** `fetchJarHistory` runs against the live chain and returns an empty list, because no Cookie Jar payment exists anywhere. The parsing path (memo matching, balance deltas, token totals) has never seen a real row. This is the single biggest thing the funded test proves.

**The name may still collide.** The cookiechain.wtf ecosystem page has no "Cookie Jar" in its served HTML, and no `jar.cook` name is registered among the 106 domains currently in the registry. Pages 2 and 3 of the ecosystem list are rendered client-side and were not read. The BRIEF names "Crumbs", "Tipjar.cook" and "Bakery Tab" as fallbacks.

**Cookie Chain's finality behaviour is unmeasured.** `waitForSignature` polls for 60 seconds before giving up. That number is a guess, not a measurement of how long this chain takes to confirm.

**Two `npm audit` advisories have no fix.** `bigint-buffer` and the React Native packages that `@solana/wallet-adapter-react` pulls in for mobile wallet support. Both come from the Solana dependency tree.

## What was verified, and how

`npm run live` prints all of it. As of 2026-09-08, 16 of 16 pass against `rpc.cookiescan.io` at solana-core 4.1.2:

- `cookie.cook` resolves to `4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx`, read from the registry program
- an unregistered name resolves to nothing and paying it is refused
- COOK is $0.00009129840365826916, and $25.00 quotes to 273,827.349709201 COOK
- a 1,000 COOK payment with a memo simulates clean from a funded wallet, memo program executed
- the same payment from a fresh keypair fails with `AccountNotFound` and nothing else
- a 933.808685393 TRASHCOIN payment simulates clean from a real holder, creating the recipient's token account in the same transaction
- both aggregators quote and build a swap transaction that simulates clean, fee payer set to the swapper
- the bridge answers HTTP 200

The link, memo, amount and dollar-quote logic also has 21 unit tests (`npm test`), and four render tests mount the app at each route.

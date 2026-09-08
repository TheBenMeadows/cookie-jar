# Cookie Jar — build brief

Entry for the Superteam Earn bounty "Create an App on Cookie Chain" ($1,000 USDC, 2 × $500, 26 submissions as of 2026-09-08, deadline 2026-09-22 21:59 UTC). Judged on: meaningful on-chain interaction with Cookie Chain, use of Cookie ecosystem integrations (Cookiebox, Cookieswap, Cookie DAS API, cookie-mcp), deployed + publicly accessible, open source, comprehensive README. Submission = live URL + GitHub repo + relevant addresses + an X thread.

## The product

**Cookie Jar — payment links and tip jars on Cookie Chain.** A creator or merchant connects a wallet, creates a request ("25,000 COOK for the logo", "tip jar for @baker"), and gets a short link + QR. The payer opens it, connects, pays on Cookie Chain, and both sides get an on-chain receipt. Names resolve through CookOven (`baker.cook`), amounts can be quoted in USD via the Cookiescan price API, and a payer holding a different token can swap through the Cookiebox/Candy Shop aggregator route before paying. Every payment is a real Cookie Chain transaction with a memo, so a jar's history is reconstructable from chain data alone.

Why this shape: the three known competitor entries are an analytics hub (CookiePulse), a kitchen-sink launchpad/DEX terminal (CookieFi Portal), and a signal board (Cookie Alpha Radar). None is a payments primitive. Payment links are a public-good creator tool, obviously useful, and every interaction is on-chain.

## Chain facts (verified 2026-09-08)

- SVM chain, Solana tooling works unchanged. RPC `https://rpc.cookiescan.io` (solana-core 4.1.2, live), WS `https://wss.cookiescan.io`. Fee 0.000005 COOK per signature.
- COOK is the native gas token (`So111…112` as wrapped, decimals 9). Bridged Solana mint `36ZrtQoab5MhhySaP1YSTwUahSk6GRVUTtZ6cuVfm9e1`. Price ≈ $0.00009 (1M COOK ≈ $90).
- Cookiescan REST: `https://api.cookiescan.io/api/price/:mint`, `/api/tokens`, `/api/tokens/search?q=`, `/api/markets`, `/api/markets/:mint`; canonical asset registry `/v1/assets…` (`/v1/assets/curated?list=majors` works); DAS JSON-RPC on the same host. Docs at https://api.cookiescan.io/ (read it — routes beyond the ones listed here exist).
- Wallets: Nightly is the bounty-endorsed wallet (https://nightly.app); use `@solana/wallet-adapter-react` + wallet-standard auto-detection so Nightly/Phantom/Solflare/Backpack all appear, with Nightly first. Custom RPC = ours.
- Names: CookOven `.cook` name service, https://book.cookoven.xyz (find its program id / resolver — cookie-mcp implements resolve, read its source at https://github.com/cookiechain/cookie-mcp for the exact accounts/API).
- Swap aggregators: Cookiebox Swap API (cookie-mcp README says `https://agg.cookiebox.app`; root 404s — find the real quote/swap routes in cookie-mcp's source) and Candy Shop `https://swap.cookiescan.io`.
- Ecosystem/collision check: https://www.cookiechain.wtf/ecosystem and https://onboard.cookiechain.wtf/ — if something named "Cookie Jar" already exists on the chain, rename (candidates: "Crumbs", "Tipjar.cook", "Bakery Tab").
- No faucet is known. Live on-chain testing needs a few dollars of COOK bridged from Solana; that is Ben's action and is NOT yours. Build and test against RPC reads + transaction *simulation* (`simulateTransaction`) with an unfunded keypair; structure the code so the funded end-to-end test is a single documented step.

## Stack

Vite + React + TypeScript, `@solana/web3.js`, `@solana/wallet-adapter-react` (+ `-react-ui`, `-wallets`), `qrcode`, no backend. Links encode the request in the URL (base64url JSON: recipient, amount, token mint, memo, label) so nothing is stored server-side; a jar's history is read from chain via `getSignaturesForAddress` + memo parsing. Static output deploys to Cloudflare Pages. Node ≥ 22 is on this machine.

Pages the app needs: Create (form → link + QR), Pay (decode link, resolve name, show USD, connect, optional swap step, send, receipt with explorer link `https://cookiescan.io/tx/<sig>`), Jar (public history for an address or `.cook` name), and an About/README-mirror page. Mobile-first — the chain's users are on phones.

## Working rules for this build (restated for a fresh context)

- Work ONLY under `/Users/bemeadows/Projects/superteam-sept26/cookie-jar/`. `git init` there once the skeleton exists and commit as you go with plain messages; NO remote, NO push, NO repo creation on GitHub — that is a per-item APPROVE from Ben.
- Do NOT deploy anywhere (Cloudflare Pages is an APPROVE-gated mutation). Do NOT post anything anywhere. Do NOT use the `browser` MCP (it drives Ben's real browser and is in use). Read the web with `seek read <url>` / `seek search "…"` and `curl`.
- Commit messages and PR text never mention Claude, sessions, or AI tooling, and carry no Co-Authored-By footer.
- Bulk implementation goes to the Gemini lane: `agyx "<precise task>" -d /Users/bemeadows/Projects/superteam-sept26/cookie-jar` (edits-only; it cannot run shell). You run `npm install`, `npm run build`, `npm run lint`, `npx tsc --noEmit` yourself and feed errors back. Review every diff it makes; it is a cheap lane and its output is a claim until the build and your read confirm it. Anything under ~200 lines, write yourself.
- No secrets in argv, ever. No real keys in the repo. Fee-payer for simulation = a throwaway `Keypair.generate()`.
- `npm install` is fine; keep `maxsockets` as configured in `~/.npmrc` (home uplink is 5G FWA).
- Any Python helper: `#!/opt/homebrew/bin/python3`, never `/usr/bin/python3` or bare `env python3`.
- Prose in README/docs: one paragraph per line, no hard wraps; bare URLs on their own lines. Before finishing the README and the X-thread draft, read `~/Projects/claude-ai/reference/anti-tropes-instruction.md` and apply it.
- Design: before writing any CSS, run `openssl rand -hex 8` and derive a creative direction from that string (never show it); the chain's culture is playful-degen with a bakery motif, the app must still read as a serious payments tool. Polish = delete. No gradients/glows. Load the `artifact-design` guidance is not available to you; use plain judgment and the dataviz-free, single-typeface, high-contrast rule.

## Deliverables (report these back with paths)

1. Working app: `npm run build` clean, `npx tsc --noEmit` clean, lint clean; `vite preview` serves it; simulation-based tests pass against live RPC for: link encode/decode round-trip, `.cook` name resolution (a real registered name you find on chain), USD quote, transfer-tx build + `simulateTransaction` success for an unfunded payer (expect "insufficient funds" as the only error — that proves the tx is otherwise valid), swap quote fetch.
2. `README.md` — what it is, how it works on-chain, setup, env vars, deploy (Pages), the addresses/programs it touches, and how to run the funded end-to-end test.
3. `SUBMISSION.md` — the Superteam form answers (live URL placeholder, repo placeholder, addresses), an X-thread draft (6–8 posts, includes a pointer to the Cookie Chain Bridge for users who need COOK), and the Telegram share line.
4. `HANDOFF.md` — exactly what still needs Ben: COOK funding amount + why, wallet to use, Pages project name + custom domain suggestion (`jar.mdws.me`?), GitHub repo name, anything you could not verify.
5. A list of every claim in the README you did not verify against the live chain.

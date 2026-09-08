import { afterEach, describe, expect, it, vi } from "vitest";

import { COOK_DECIMALS, COOK_MINT } from "./config";
import { COOK_TOKEN, fetchCookPriceUsd, fetchNativeToken, fetchToken, searchTokens } from "./tokens";

/**
 * Recorded from `GET https://api.cookiescan.io/v1/assets/cook` on 2026-09-08, trimmed to the fields
 * this app reads. COOK exists under three mints and the registry resolves all of them to this one
 * entry, which is why the native price comes from here rather than from a mint lookup.
 */
const ASSET_COOK = {
  assetId: "cook",
  name: "Cookie",
  symbol: "COOK",
  category: "crypto",
  curated: true,
  stats: {
    price: 0.00009129840365826916,
    priceInCook: 1,
    liquidity: 6224.329525613842,
    volume24hUSD: 1.484707969501079,
    marketCap: null,
    holder: 1367,
    supply: null,
  },
  variantCount: 3,
  primaryVariant: {
    variantId: "cook:wCOOK",
    mint: "So11111111111111111111111111111111111111112",
    symbol: "wCOOK",
    name: "Wrapped COOK",
    kind: "wrapped",
    market: { price: 0.00009129840365826916, decimals: 9 },
  },
};

/** Recorded from `GET /api/price/GNFq…5T6z` on 2026-09-08. The shape a non-native mint answers with. */
const PRICE_TRASHCOIN = {
  success: true,
  data: {
    mint: "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z",
    metadata: { name: "TRASHCOIN", symbol: "TRASHCOIN", logo: null, decimals: 9 },
    price: { usd: 0.0009158732247642772, native: 10.031, change24h: 0 },
    marketData: { liquidity: 923.9429600437281 },
  },
};

function mockJson(byUrl: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const match = Object.entries(byUrl).find(([fragment]) => url.includes(fragment));
      if (!match) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(match[1]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the native token", () => {
  it("is unpriced before anything is fetched", () => {
    // The bug this guards: `COOK_TOKEN` was used directly as the selected token on the Create page,
    // so the dollar option was disabled from first paint and claimed Cookiescan had no COOK price.
    expect(COOK_TOKEN.priceUsd).toBeNull();
  });

  it("carries a price once read from the asset registry", async () => {
    mockJson({ "/v1/assets/cook": ASSET_COOK });
    const token = await fetchNativeToken();
    expect(token.priceUsd).toBe(0.00009129840365826916);
    expect(token.liquidityUsd).toBe(6224.329525613842);
  });

  it("keeps the mint and the decimals that build a transfer, whatever the registry says", async () => {
    mockJson({
      "/v1/assets/cook": {
        ...ASSET_COOK,
        primaryVariant: { ...ASSET_COOK.primaryVariant, mint: "wrong", market: { decimals: 6 } },
      },
    });
    const token = await fetchNativeToken();
    expect(token.mint).toBe(COOK_MINT);
    expect(token.decimals).toBe(COOK_DECIMALS);
    expect(token.symbol).toBe("COOK");
  });

  it("reaches the registry through the wrapped mint and through the alias", async () => {
    mockJson({ "/v1/assets/cook": ASSET_COOK });
    expect((await fetchToken(COOK_MINT))?.priceUsd).toBe(0.00009129840365826916);
    expect((await fetchToken("cook"))?.priceUsd).toBe(0.00009129840365826916);
    expect(await fetchCookPriceUsd()).toBe(0.00009129840365826916);
  });

  it("hides the figure rather than the page when the registry is down", async () => {
    mockJson({});
    expect(await fetchCookPriceUsd()).toBeNull();
  });
});

describe("other tokens", () => {
  it("reads a price from the mint endpoint", async () => {
    mockJson({ "/api/price/": PRICE_TRASHCOIN });
    const token = await fetchToken("GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z");
    expect(token?.symbol).toBe("TRASHCOIN");
    expect(token?.decimals).toBe(9);
    expect(token?.priceUsd).toBe(0.0009158732247642772);
  });

  it("orders search results by liquidity, not by how the registry ordered them", async () => {
    mockJson({
      "/api/tokens/search": {
        data: [
          { mint: "A", metadata: { symbol: "THIN", decimals: 9 }, marketData: { liquidity: 1 } },
          { mint: "B", metadata: { symbol: "DEEP", decimals: 6 }, marketData: { liquidity: 900 } },
          { mint: "C", metadata: { symbol: "NONE", decimals: 9 } },
        ],
      },
    });
    expect((await searchTokens("x")).map((t) => t.symbol)).toEqual(["DEEP", "THIN", "NONE"]);
  });

  it("drops a registry row with no decimals rather than guessing at them", async () => {
    mockJson({ "/api/tokens/search": { data: [{ mint: "A", metadata: { symbol: "X" } }] } });
    expect(await searchTokens("x")).toEqual([]);
  });
});

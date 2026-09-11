// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What the Confirm button offers after a payer changes their mind. The wallet, the balances, the
 * aggregators and the registry are all stubbed, so this signs nothing and touches no network.
 */

const TRASH = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";
const COOK = "So11111111111111111111111111111111111111112";
const OWNER = new PublicKey("4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx");

const stubs = vi.hoisted(() => ({
  signTransaction: vi.fn(async (t: unknown) => t),
  fetchToken: vi.fn(async () => ({ symbol: "TRASH", priceUsd: 0.001, decimals: 9 })),
  /** Each built swap is labelled with its own input amount, so a test can tell two of them apart. */
  buildSwapTransaction: vi.fn(async (quote: { inAmount: string }) => ({
    transactionBase64: Buffer.from(`tx-for-${quote.inAmount}`).toString("base64"),
  })),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ signTransaction: stubs.signTransaction }),
}));

vi.mock("../lib/chain", () => ({
  getConnection: () => ({ sendRawTransaction: vi.fn(async () => "sig") }),
  waitForSignature: vi.fn(async () => undefined),
}));

vi.mock("../lib/balances", () => ({
  fetchNativeBalance: vi.fn(async () => ({
    mint: COOK,
    raw: 0n,
    spendable: 0n,
    accountCount: 1,
    decimals: 9,
    symbol: "COOK",
  })),
  fetchTokenHoldings: vi.fn(async () => [
    {
      mint: TRASH,
      raw: 1_000_000_000_000n,
      spendable: 1_000_000_000_000n,
      accountCount: 1,
      decimals: 9,
      symbol: "TRASH",
    },
  ]),
}));

vi.mock("../lib/tokens", () => ({ fetchToken: stubs.fetchToken }));

vi.mock("../lib/swap", () => ({
  bestSwapQuote: vi.fn(async (args: { rawAmount: string }) => ({
    aggregator: "cookiebox",
    inputMint: TRASH,
    outputMint: COOK,
    inAmount: args.rawAmount,
    outAmount: String(BigInt(args.rawAmount) * 5n),
    minOutAmount: String(BigInt(args.rawAmount) * 4n),
    priceImpactPct: 0,
    venues: ["test"],
    swapUrl: "https://example.invalid",
    route: {},
  })),
  buildSwapTransaction: stubs.buildSwapTransaction,
  verifySwapTransaction: vi.fn(async (a: { quote: { outAmount: string } }) => ({
    ok: true,
    reason: null,
    expectedOutRaw: BigInt(a.quote.outAmount),
  })),
}));

vi.mock("@solana/web3.js", async (original) => {
  const actual = await original<typeof import("@solana/web3.js")>();
  return {
    ...actual,
    VersionedTransaction: {
      ...actual.VersionedTransaction,
      // The stub's "transaction" is its own label, so a test can read which one was handed over.
      deserialize: (bytes: Uint8Array) => ({
        label: new TextDecoder().decode(bytes),
        serialize: () => bytes,
      }),
    },
  };
});

const { SwapPanel } = await import("./SwapPanel");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function prepareASwap(): Promise<HTMLInputElement> {
  render(
    <SwapPanel
      owner={OWNER}
      targetMint={COOK}
      targetDecimals={9}
      targetSymbol="COOK"
      shortfallRaw={5_000_000_000n}
      onSwapped={() => undefined}
    />,
  );

  fireEvent.change(await screen.findByRole("combobox"), { target: { value: TRASH } });
  const field = await waitFor(() => {
    const el = document.querySelector("input[inputmode='decimal']") as HTMLInputElement | null;
    if (!el || el.value === "") throw new Error("the amount field has not been seeded yet");
    return el;
  });

  fireEvent.change(field, { target: { value: "100" } });
  fireEvent.click(screen.getByText("Get a quote"));
  await waitFor(() => screen.getByText("Check this swap"));
  fireEvent.click(screen.getByText("Check this swap"));
  await waitFor(() => screen.getByText(/^Confirm: receive/));
  return field;
}

describe("a prepared swap belongs to the amount it was quoted for", () => {
  it("is dropped when the payer edits the amount", async () => {
    const field = await prepareASwap();
    fireEvent.change(field, { target: { value: "10" } });

    expect(screen.queryByText(/^Confirm: receive/)).toBeNull();
    expect(document.querySelector("dl.rows")).toBeNull();
    // The way forward is a fresh quote for the amount now in the field.
    expect(screen.getByText("Get a quote")).toBeDefined();
    expect(stubs.signTransaction).not.toHaveBeenCalled();
  });

  it("is dropped when the seeded suggestion lands late and rewrites the amount", async () => {
    // The suggestion reads two prices before it can answer, so it is held open here while the payer
    // gets on with a swap of their own figure.
    let seed = (_: { symbol: string; priceUsd: number; decimals: number }) => undefined as void;
    const held = new Promise<{ symbol: string; priceUsd: number; decimals: number }>((resolve) => {
      seed = resolve;
    });

    render(
      <SwapPanel
        owner={OWNER}
        targetMint={COOK}
        targetDecimals={9}
        targetSymbol="COOK"
        shortfallRaw={5_000_000_000n}
        onSwapped={() => undefined}
      />,
    );

    const select = await screen.findByRole("combobox");
    stubs.fetchToken.mockReturnValueOnce(held);
    fireEvent.change(select, { target: { value: TRASH } });

    const field = (await screen.findByDisplayValue("")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "100" } });
    fireEvent.click(screen.getByText("Get a quote"));
    await waitFor(() => screen.getByText("Check this swap"));
    fireEvent.click(screen.getByText("Check this swap"));
    await waitFor(() => screen.getByText(/^Confirm: receive/));

    seed({ symbol: "TRASH", priceUsd: 0.001, decimals: 9 });

    await waitFor(() => expect(field.value).not.toBe("100"));
    expect(screen.queryByText(/^Confirm: receive/)).toBeNull();
    expect(stubs.signTransaction).not.toHaveBeenCalled();
  });

  it("is dropped when the payer picks another token to swap from", async () => {
    await prepareASwap();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: COOK } });

    expect(screen.queryByText(/^Confirm: receive/)).toBeNull();
    expect(stubs.signTransaction).not.toHaveBeenCalled();
  });
});

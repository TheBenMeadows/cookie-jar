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
  signatureOutcome: vi.fn(async () => ({ err: null as unknown })),
  /** The composed transaction is labelled so a test can see it was the one signed. */
  composeSwapAndPayment: vi.fn((args: { swap: { label: string }; payment: unknown[] }) => ({
    ok: true as const,
    bytes: 900,
    transaction: {
      label: `${args.swap.label}+pay(${args.payment.length})`,
      serialize: () => new Uint8Array([2]),
    },
  })),
  verifyComposedCheckout: vi.fn(async () => ({ ok: true, reason: null as string | null })),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ signTransaction: stubs.signTransaction }),
}));

vi.mock("../lib/chain", () => ({
  getConnection: () => ({
    sendRawTransaction: vi.fn(async () => "sig"),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: "abc", lastValidBlockHeight: 1 })),
  }),
  waitForSignature: vi.fn(async () => undefined),
  signatureOutcome: stubs.signatureOutcome,
}));

vi.mock("../lib/checkout", () => ({
  lookupTablesOf: vi.fn(async () => []),
  composeSwapAndPayment: stubs.composeSwapAndPayment,
  verifyComposedCheckout: stubs.verifyComposedCheckout,
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

type Checkout = NonNullable<Parameters<typeof SwapPanel>[0]["checkout"]>;

async function prepareASwap(checkout?: Checkout): Promise<HTMLInputElement> {
  render(
    <SwapPanel
      owner={OWNER}
      targetMint={COOK}
      targetDecimals={9}
      targetSymbol="COOK"
      shortfallRaw={5_000_000_000n}
      onSwapped={() => undefined}
      checkout={checkout}
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
  await waitFor(() => screen.getByText(/^(Confirm|Swap only): receive/));
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

describe("swap and pay in one transaction", () => {
  // The quote stub returns 5× the input, so 100 in → 500 COOK out, against a 5 COOK payment.
  function checkoutFor(rawAmount: bigint, heldRaw = 0n) {
    return {
      heldRaw,
      rawAmount,
      build: vi.fn(async () => ({ instructions: [{}, {}] as never[], destination: OWNER, native: true })),
      onPaid: vi.fn<(signature: string) => void>(),
      onFailed: vi.fn<(signature: string, err: unknown) => void>(),
    } satisfies Checkout;
  }

  it("is offered when the swap covers the payment, and signs the composed transaction", async () => {
    const checkout = checkoutFor(5_000_000_000n);
    await prepareASwap(checkout);

    const button = screen.getByText(/^Swap and pay 5 COOK in one transaction/);
    expect(screen.getByText(/^Swap only: receive/)).toBeDefined();
    fireEvent.click(button);

    await waitFor(() => expect(checkout.onPaid).toHaveBeenCalledWith("sig"));
    expect(stubs.verifyComposedCheckout).toHaveBeenCalledTimes(1);
    expect(stubs.signTransaction).toHaveBeenCalledTimes(1);
    expect((stubs.signTransaction.mock.calls[0]?.[0] as { label: string }).label).toBe(
      "tx-for-100000000000+pay(2)",
    );
    expect(checkout.onFailed).not.toHaveBeenCalled();
  });

  it("is not offered when the swap plus what is held falls short of the payment", async () => {
    await prepareASwap(checkoutFor(10n ** 15n));
    expect(screen.queryByText(/in one transaction/)).toBeNull();
    expect(screen.getByText(/^Confirm: receive/)).toBeDefined();
  });

  it("withdraws the offer and keeps the swap-only path when the two do not fit one transaction", async () => {
    stubs.composeSwapAndPayment.mockReturnValueOnce({ ok: false, reason: "too-big", bytes: 1247 } as never);
    const checkout = checkoutFor(5_000_000_000n);
    await prepareASwap(checkout);
    fireEvent.click(screen.getByText(/^Swap and pay/));

    await waitFor(() => screen.getByText(/do not fit in one transaction \(1247 bytes\)/));
    expect(screen.queryByText(/^Swap and pay/)).toBeNull();
    expect(screen.getByText(/^Confirm: receive/)).toBeDefined();
    expect(stubs.signTransaction).not.toHaveBeenCalled();
    expect(checkout.onPaid).not.toHaveBeenCalled();
  });

  it("does not sign when the composed transaction fails its check", async () => {
    stubs.verifyComposedCheckout.mockResolvedValueOnce({ ok: false, reason: "the recipient would receive 1 base units rather than the 5000000000 requested" });
    const checkout = checkoutFor(5_000_000_000n);
    await prepareASwap(checkout);
    fireEvent.click(screen.getByText(/^Swap and pay/));

    await waitFor(() => screen.getByText(/would receive 1 base units/));
    expect(stubs.signTransaction).not.toHaveBeenCalled();
    expect(screen.getByText(/^Swap and pay/)).toBeDefined();
  });

  it("reports a composed transaction that lands and fails on chain as a failure", async () => {
    stubs.signatureOutcome.mockResolvedValueOnce({ err: { InstructionError: [7, "Custom"] } });
    const checkout = checkoutFor(5_000_000_000n);
    await prepareASwap(checkout);
    fireEvent.click(screen.getByText(/^Swap and pay/));

    await waitFor(() => expect(checkout.onFailed).toHaveBeenCalledWith("sig", { InstructionError: [7, "Custom"] }));
    expect(checkout.onPaid).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What a payer reads on the screen that stands in front of the wallet prompt, and what they read
 * afterwards. The wallet, the chain and the token registry are all stubbed: nothing here signs
 * anything, sends anything or touches Cookie Chain.
 */

const RECIPIENT = "7rQTSWbk1nMRPve2q3wcS1rT6g2shkXkNDGnZX53zEzR";
const PAYER = new PublicKey("4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx");
const TRASHCOIN = "GNFqCqaU9R2jas4iaKEFZM5hiX5AHxBL7rPHTCpX5T6z";

const stubs = vi.hoisted(() => ({
  sendTransaction: vi.fn(async () => "5SzTvsSQDq1PJyS5dR9hxYyTHrTQPJn9pQeSCHbdVMpU"),
  confirmTransaction: vi.fn(async () => ({ value: { err: null as unknown } })),
  fetchToken: vi.fn(async () => null as { symbol: string; priceUsd: number | null } | null),
  recipientAccountRent: vi.fn(async () => 0n),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    publicKey: PAYER,
    connected: true,
    sendTransaction: stubs.sendTransaction,
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
  }),
}));

vi.mock("../lib/chain", () => ({
  getConnection: () => ({
    confirmTransaction: stubs.confirmTransaction,
    getLatestBlockhash: vi.fn(async () => ({ blockhash: "abc", lastValidBlockHeight: 1 })),
  }),
  waitForSignature: vi.fn(async () => undefined),
}));

vi.mock("../lib/pay", () => ({
  recipientAccountRent: stubs.recipientAccountRent,
  buildPayment: vi.fn(async () => ({
    transaction: {},
    createsRecipientAccount: false,
    tokenProgramId: null,
    blockhash: "abc",
    lastValidBlockHeight: 1,
  })),
  simulatePayment: vi.fn(async () => ({
    ok: true,
    err: null,
    logs: [],
    insufficientFunds: false,
    unfundedAccount: false,
    message: null,
  })),
}));

vi.mock("../lib/balances", () => ({
  fetchBalanceOf: vi.fn(async (_c: unknown, _o: unknown, mint?: string) => ({
    mint: mint ?? "So11111111111111111111111111111111111111112",
    raw: 10n ** 30n,
    spendable: 10n ** 30n,
    accountCount: 1,
    decimals: 9,
    symbol: null,
  })),
}));

vi.mock("../lib/tokens", () => ({ fetchToken: stubs.fetchToken }));

const { Pay } = await import("./Pay");
const { encodeRequest } = await import("../lib/request");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  stubs.fetchToken.mockResolvedValue(null);
  stubs.confirmTransaction.mockResolvedValue({ value: { err: null } });
  stubs.recipientAccountRent.mockResolvedValue(0n);
});

describe("an amount the headline has to round", () => {
  it("prints the exact figure under it and on the button", async () => {
    const payload = encodeRequest({
      to: RECIPIENT,
      label: "Invoice",
      amount: "1500.49",
      mint: TRASHCOIN,
      decimals: 2,
      symbol: "GOLD",
    });
    render(<Pay payload={payload} />);

    expect(await screen.findByText("Invoice")).toBeDefined();
    expect(document.querySelector(".amount")?.textContent).toBe("1,500GOLD");
    expect(document.querySelector(".exact")?.textContent).toBe("1,500.49 GOLD exactly");
    await waitFor(() =>
      expect(document.querySelector("button.primary")?.textContent).toBe("Pay 1,500.49 GOLD"),
    );
  });
});

describe("the ticker beside the amount", () => {
  it("is the registry's, not the one the link carries", async () => {
    stubs.fetchToken.mockResolvedValue({ symbol: "TRASH", priceUsd: null });
    const payload = encodeRequest({
      to: RECIPIENT,
      label: "Bakery Tab",
      amount: "25000",
      mint: TRASHCOIN,
      decimals: 9,
      symbol: "COOK",
    });
    render(<Pay payload={payload} />);

    expect(await screen.findByText("Bakery Tab")).toBeDefined();
    await waitFor(() => expect(document.querySelector(".amount")?.textContent).toBe("25,000TRASH"));
  });

  it("falls back to the link when the registry names none", async () => {
    stubs.fetchToken.mockResolvedValue({ symbol: "?", priceUsd: null });
    const payload = encodeRequest({
      to: RECIPIENT,
      label: "Bakery Tab",
      amount: "25000",
      mint: TRASHCOIN,
      decimals: 9,
      symbol: "GOLD",
    });
    render(<Pay payload={payload} />);

    expect(await screen.findByText("Bakery Tab")).toBeDefined();
    expect(document.querySelector(".amount")?.textContent).toBe("25,000GOLD");
  });
});

describe("a transaction that lands and fails on chain", () => {
  it("is reported as a failure, never as Paid", async () => {
    stubs.confirmTransaction.mockResolvedValue({
      value: { err: { InstructionError: [1, { Custom: 1 }] } },
    });
    const payload = encodeRequest({ to: RECIPIENT, label: "Invoice", amount: "10" });
    render(<Pay payload={payload} />);

    const button = await screen.findByText("Pay 10 COOK");
    fireEvent.click(button);

    expect(await screen.findByText("This payment failed on chain")).toBeDefined();
    expect(screen.queryByText("Paid")).toBeNull();
    expect(document.body.textContent).toContain("InstructionError");
    expect(screen.getByText("Try this payment again")).toBeDefined();
    const explorer = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(explorer.some((href) => href?.includes("5SzTvsSQDq1PJyS5dR9hxYyTHrTQPJn9pQeSCHbdVMpU"))).toBe(
      true,
    );
  });

  it("shows the paid screen when the chain reports no error", async () => {
    const payload = encodeRequest({ to: RECIPIENT, label: "Invoice", amount: "10" });
    render(<Pay payload={payload} />);

    fireEvent.click(await screen.findByText("Pay 10 COOK"));

    expect(await screen.findByText("Paid")).toBeDefined();
    expect(screen.queryByText("This payment failed on chain")).toBeNull();
  });
});

describe("recipient token account rent in network fee row", () => {
  it("renders extra rent fee when recipient token account does not exist", async () => {
    stubs.recipientAccountRent.mockResolvedValue(2_039_280n);

    const payload = encodeRequest({
      to: RECIPIENT,
      label: "Token Transfer",
      amount: "50",
      mint: TRASHCOIN,
      decimals: 9,
      symbol: "TRASH",
    });
    render(<Pay payload={payload} />);

    expect(
      await screen.findByText(/0\.00203928 COOK to open their token account/),
    ).toBeDefined();
  });

  it("does not render extra rent fee when recipient token account exists", async () => {
    stubs.recipientAccountRent.mockResolvedValue(0n);

    const payload = encodeRequest({
      to: RECIPIENT,
      label: "Token Transfer",
      amount: "50",
      mint: TRASHCOIN,
      decimals: 9,
      symbol: "TRASH",
    });
    render(<Pay payload={payload} />);

    await screen.findByText("Token Transfer");
    expect(
      screen.queryByText(/0\.00203928 COOK to open their token account/),
    ).toBeNull();
  });
});

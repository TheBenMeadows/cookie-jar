// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import "../polyfill";
import { Replay } from "./Replay";
import type { TxDetail } from "../lib/txdetail";

afterEach(cleanup);

const SIGNATURE = "3R1C9BBUH3K42jGQHfP5qSqkx4p4hxeWZyva5c5hHERogspxRnkK2X1C3pwAXKVvFYEykoG1ZWXvBhzxffnp5hFL";

const detail: TxDetail = {
  signatures: 1,
  instructions: 3,
  innerInstructions: 4,
  programs: ["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"],
  hasMemo: true,
  steps: [
    {
      position: 1,
      programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
      parsed: null,
      sentence: null,
    },
    {
      position: 2,
      programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      parsed: "spl-token transferChecked",
      sentence: "Pays the recipient, against the mint and decimals the request named",
    },
    {
      position: 3,
      programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      parsed: "spl-memo",
      sentence: "Writes the invoice reference on chain, which is what puts the payment in a jar",
    },
  ],
};

describe("the transaction replay", () => {
  it("starts closed, so the proof line reads as one sentence until asked", () => {
    render(<Replay detail={detail} signature={SIGNATURE} />);
    expect(screen.getByRole("button", { name: "Step through this transaction" })).toBeDefined();
    expect(screen.queryByText(/Pays the recipient/)).toBeNull();
  });

  it("reveals one instruction at a time", () => {
    render(<Replay detail={detail} signature={SIGNATURE} />);
    fireEvent.click(screen.getByRole("button", { name: "Step through this transaction" }));
    expect(screen.getByText("1 of 3")).toBeDefined();
    expect(screen.queryByText("2 of 3")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next instruction" }));
    expect(screen.getByText("2 of 3")).toBeDefined();
    expect(screen.getByText(/Pays the recipient/)).toBeDefined();
  });

  it("names a program it cannot describe without inventing a description for it", () => {
    render(<Replay detail={detail} signature={SIGNATURE} />);
    fireEvent.click(screen.getByRole("button", { name: "Step through this transaction" }));
    const first = screen.getByTitle("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
    expect(first.textContent).toBe("cpamd…n1sGG");
  });

  it("ends on the explorer and says what one signature covered", () => {
    render(<Replay detail={detail} signature={SIGNATURE} />);
    fireEvent.click(screen.getByRole("button", { name: "Step through this transaction" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all 3" }));
    expect(screen.getByText("3 of 3")).toBeDefined();
    expect(screen.getByText("One signature authorised all 3.")).toBeDefined();
    const link = screen.getByRole("link", { name: "All 3 on the explorer" });
    expect(link.getAttribute("href")).toContain(SIGNATURE);
  });

  it("closes back to the single control", () => {
    render(<Replay detail={detail} signature={SIGNATURE} />);
    fireEvent.click(screen.getByRole("button", { name: "Step through this transaction" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Step through this transaction" })).toBeDefined();
    expect(screen.queryByText("1 of 3")).toBeNull();
  });
});

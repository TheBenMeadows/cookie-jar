// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "./polyfill";
import { App } from "./App";
import { decodeRequest, encodeRequest } from "./lib/request";

/**
 * Render checks. They catch what a build cannot: a module that only breaks once it runs in a
 * browser, and a page that throws on its first paint. Network calls are stubbed, so nothing here
 * touches Cookie Chain — the live suite in `scripts/live-check.ts` does that.
 */

vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })),
);

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

function renderAt(hash: string): void {
  window.location.hash = hash;
  render(<App />);
}

describe("the app renders", () => {
  it("opens on the live invoice, with the link builder under it", async () => {
    renderAt("#/");
    expect(await screen.findByText("Pay this invoice from whatever you hold")).toBeDefined();
    expect(screen.getByRole("button", { name: "Pay this invoice" })).toBeDefined();
    // The form keeps its heading, one level down: the page's own heading is the invoice.
    expect(screen.getByRole("heading", { level: 2, name: "Make a payment link" })).toBeDefined();
    expect(screen.getByPlaceholderText("baker.cook or a Cookie Chain address")).toBeDefined();
    // The stubbed RPC never answers usefully. The proof line under the button either waits on it or
    // says the chain could not be read; it never throws and never claims a payment.
    expect(
      await screen.findByText(/Reading the last payment|could not be read just now/),
    ).toBeDefined();
  });

  it("pressing Pay opens a payment link for the showcase invoice with a fresh reference", async () => {
    renderAt("#/");
    (await screen.findByRole("button", { name: "Pay this invoice" })).click();
    expect(window.location.hash.startsWith("#/pay/")).toBe(true);
    const request = decodeRequest(window.location.hash.slice("#/pay/".length));
    expect(request.to).toBe("cookietab.cook");
    expect(request.amount).toBe("700");
    expect(request.ref).toMatch(/^TAB-[0-9A-HJKMNP-TV-Z]{7}$/);
  });

  it("shows the reference page", async () => {
    renderAt("#/about");
    expect(await screen.findByText("How Cookie Tab works")).toBeDefined();
    // Shortened on screen, with the whole key still reachable for anyone comparing one.
    const memo = screen.getByTitle("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    expect(memo.textContent).toBe("MemoSq…GmfcHr");
    expect(memo.getAttribute("href")).toContain("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  });

  it("reads a payment link", async () => {
    const payload = encodeRequest({
      to: "4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx",
      label: "Bakery Tab",
      amount: "25000",
    });
    renderAt(`#/pay/${payload}`);
    expect(await screen.findByText("Bakery Tab")).toBeDefined();
    expect(screen.getByText("25,000")).toBeDefined();
  });

  it("says so when a link is damaged", async () => {
    renderAt("#/pay/this-is-not-a-payment-request");
    expect(await screen.findByText("This link cannot be read")).toBeDefined();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "./polyfill";
import { App } from "./App";
import { encodeRequest } from "./lib/request";

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
  it("opens on the create page", async () => {
    renderAt("#/");
    expect(await screen.findByText("Make a payment link")).toBeDefined();
    expect(screen.getByPlaceholderText("baker.cook or a Cookie Chain address")).toBeDefined();
  });

  it("shows the reference page", async () => {
    renderAt("#/about");
    expect(await screen.findByText("How Cookie Jar works")).toBeDefined();
    expect(screen.getByText("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")).toBeDefined();
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

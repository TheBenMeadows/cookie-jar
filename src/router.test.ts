import { describe, expect, it } from "vitest";

import { parseHash } from "./router";

describe("parseHash", () => {
  it("routes a jar with and without a reference", () => {
    expect(parseHash("#/jar/baker.cook")).toEqual({ name: "jar", recipient: "baker.cook", ref: null });
    expect(parseHash("#/jar/baker.cook?ref=INV-7")).toEqual({
      name: "jar",
      recipient: "baker.cook",
      ref: "INV-7",
    });
  });

  it("decodes the reference the way the receipt link encoded it", () => {
    expect(parseHash("#/jar/baker.cook?ref=order%2042%2F3")).toMatchObject({ ref: "order 42/3" });
    expect(parseHash("#/jar/baker.cook?ref=")).toMatchObject({ ref: null });
    expect(parseHash("#/jar/baker.cook?other=1")).toMatchObject({ ref: null });
  });

  it("does not let a query stand in for a recipient", () => {
    expect(parseHash("#/jar/?ref=INV-7")).toEqual({ name: "create" });
  });

  it("leaves a pay payload untouched, query characters and all", () => {
    expect(parseHash("#/pay/abc?def")).toEqual({ name: "pay", payload: "abc?def" });
  });
});

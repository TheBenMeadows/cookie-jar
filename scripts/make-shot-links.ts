/** Prints the payment links the screenshot pass renders. Run with `npx tsx scripts/make-shot-links.ts`. */
import { encodeRequest, jarUrl, type PaymentRequest } from "../src/lib/request";

const BASE = process.argv[2] ?? "http://localhost:4173";

const cases: Array<{ name: string; request: PaymentRequest }> = [
  {
    name: "pay-fixed-cook",
    request: {
      to: "4GGk4vTDd1FCA4NHd62xcwcab86KAm6dFtG7zrGKSGUx",
      label: "Bakery Tab",
      note: "One dozen sourdough, Friday collection",
      amount: "275000",
      ref: "INV-2026-014",
    },
  },
  {
    name: "pay-usd",
    request: {
      to: "cookie.cook",
      label: "Logo and wordmark",
      note: "Second revision, final files",
      usd: "25.00",
      ref: "DES-0031",
    },
  },
  {
    name: "pay-tipjar",
    request: { to: "cookie.cook", label: "Tip jar for the baker", note: "Thanks for the bread" },
  },
  {
    name: "pay-cook-name",
    request: { to: "chef.cook", label: "Kitchen fund", amount: "50000" },
  },
];

const lines = ["# Screenshot routes", "", `Base: ${BASE}`, ""];
for (const { name, request } of cases) {
  lines.push(`## ${name}`, "", `${BASE}/#/pay/${encodeRequest(request)}`, "");
}
lines.push("## jar", "", jarUrl("cookie.cook", BASE), "");
lines.push("## create", "", `${BASE}/#/`, "");
lines.push("## about", "", `${BASE}/#/about`, "");
console.log(lines.join("\n"));

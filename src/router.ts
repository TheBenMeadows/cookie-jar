import { useEffect, useState } from "react";

/**
 * Hash routing, on purpose. A payment request lives in the URL, and the fragment never reaches a
 * server — not this app's host, not a CDN log. It also means the whole app is a plain static file
 * with no rewrite rules to get wrong on a deploy.
 */

export type Route =
  | { name: "create" }
  | { name: "pay"; payload: string }
  | { name: "jar"; recipient: string; ref: string | null }
  | { name: "about" };

/**
 * A jar route can carry a query after the recipient: `#/jar/<recipient>?ref=<reference>` narrows
 * the page to the payments carrying that reference. The query lives inside the fragment, so it
 * never reaches a server either.
 */
function splitQuery(tail: string): { path: string; params: URLSearchParams } {
  const cut = tail.indexOf("?");
  if (cut < 0) return { path: tail, params: new URLSearchParams() };
  return { path: tail.slice(0, cut), params: new URLSearchParams(tail.slice(cut + 1)) };
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [head = "", ...rest] = path.split("/");
  const tail = rest.join("/");
  if (head === "pay" && tail) return { name: "pay", payload: tail };
  if (head === "jar" && tail) {
    const { path: recipient, params } = splitQuery(tail);
    if (!recipient) return { name: "create" };
    const ref = params.get("ref")?.trim() || null;
    return { name: "jar", recipient: decodeURIComponent(recipient), ref };
  }
  if (head === "about") return { name: "about" };
  return { name: "create" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(to: string): void {
  window.location.hash = to;
}

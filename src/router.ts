import { useEffect, useState } from "react";

/**
 * Hash routing, on purpose. A payment request lives in the URL, and the fragment never reaches a
 * server — not this app's host, not a CDN log. It also means the whole app is a plain static file
 * with no rewrite rules to get wrong on a deploy.
 */

export type Route =
  | { name: "create" }
  | { name: "pay"; payload: string }
  | { name: "jar"; recipient: string }
  | { name: "about" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [head = "", ...rest] = path.split("/");
  const tail = rest.join("/");
  if (head === "pay" && tail) return { name: "pay", payload: tail };
  if (head === "jar" && tail) return { name: "jar", recipient: decodeURIComponent(tail) };
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

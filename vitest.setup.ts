/**
 * Two gaps in the test DOM that a real browser does not have: jsdom declares `window.scrollTo` and
 * then throws from it, and this Node build exposes no `localStorage`, which the wallet adapter reads
 * to remember the last wallet chosen.
 */
if (typeof window !== "undefined") {
  window.scrollTo = () => {};

  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
}

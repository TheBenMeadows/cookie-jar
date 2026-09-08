import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";

/**
 * The wallet list, and the effect that acts on a choice from it.
 *
 * Both live here because two places offer to connect: the header on most pages, and the Pay page's
 * own primary button, which is the whole job of that screen. Sharing one list keeps the ordering and
 * the wording identical wherever a payer meets it.
 */

/**
 * `select` only records the choice. Connecting is a separate step, and it has to run from somewhere
 * that stays mounted, so it lives at the top of the app rather than inside a picker that unmounts
 * the moment a wallet is picked.
 */
export function useConnectOnSelect(): string | null {
  const { wallet, connected, connecting, connect } = useWallet();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet || connected || connecting) return;
    setError(null);
    connect().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [wallet, connected, connecting, connect]);

  return error;
}

/**
 * Wallets come from Wallet Standard, so anything the browser has announced appears without this app
 * shipping an adapter for it. Nightly is first because it is Cookie Chain's own wallet; everything
 * already installed comes before everything that is not.
 */
export function WalletPicker({ onPicked }: { onPicked: () => void }): JSX.Element {
  const { wallets, select } = useWallet();

  const ordered = useMemo(() => {
    const rank = (name: string, state: WalletReadyState): number => {
      if (name.toLowerCase().includes("nightly")) return 0;
      return state === WalletReadyState.Installed ? 1 : 2;
    };
    return [...wallets].sort(
      (a, b) =>
        rank(a.adapter.name, a.readyState) - rank(b.adapter.name, b.readyState) ||
        a.adapter.name.localeCompare(b.adapter.name),
    );
  }, [wallets]);

  return (
    <div className="picker">
      {ordered.length === 0 ? (
        <p className="small">
          No Solana wallet announced itself to this browser. Nightly supports Cookie Chain:{" "}
          <a href="https://nightly.app">nightly.app</a>
        </p>
      ) : (
        <ul>
          {ordered.map((w) => (
            <li key={w.adapter.name}>
              <button
                type="button"
                onClick={() => {
                  onPicked();
                  select(w.adapter.name);
                }}
              >
                {w.adapter.icon && <img src={w.adapter.icon} alt="" />}
                <span>{w.adapter.name}</span>
                {w.readyState === WalletReadyState.Installed && (
                  <span className="installed">Installed</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

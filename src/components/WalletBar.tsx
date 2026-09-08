import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";

import { getConnection } from "../lib/chain";
import { fetchPrimaryName } from "../lib/domains";
import { shortAddress } from "../lib/format";

/**
 * Wallet connection. The list comes from Wallet Standard, so anything the browser has announced
 * shows up without this app shipping an adapter for it; Nightly is first because it is Cookie
 * Chain's own wallet, and everything already installed comes before everything that is not.
 */
export function WalletBar(): JSX.Element {
  const { wallets, wallet, select, connect, connected, connecting, disconnect, publicKey } =
    useWallet();
  const [picking, setPicking] = useState(false);
  const [primaryName, setPrimaryName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!publicKey) {
      setPrimaryName(null);
      return;
    }
    let live = true;
    fetchPrimaryName(getConnection(), publicKey)
      .then((name) => {
        if (live) setPrimaryName(name);
      })
      .catch(() => {
        if (live) setPrimaryName(null);
      });
    return () => {
      live = false;
    };
  }, [publicKey]);

  // `select` only stores the choice; the connection itself starts once the adapter is in place.
  useEffect(() => {
    if (!wallet || connected || connecting) return;
    connect().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [wallet, connected, connecting, connect]);

  if (connected && publicKey) {
    return (
      <div className="buttons">
        <span className="small mono">{primaryName ?? shortAddress(publicKey.toBase58())}</span>
        <button className="quiet" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button className="quiet" onClick={() => setPicking((v) => !v)}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {picking && (
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
                    onClick={() => {
                      setError(null);
                      setPicking(false);
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
      )}
      {error && <p className="alarm">{error}</p>}
    </>
  );
}

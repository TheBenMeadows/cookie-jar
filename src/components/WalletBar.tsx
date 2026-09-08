import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

import { WalletPicker } from "./WalletPicker";
import { getConnection } from "../lib/chain";
import { fetchPrimaryName } from "../lib/domains";
import { shortAddress } from "../lib/format";

/** The header's wallet control. The Pay page hides it and offers connection through its own action. */
export function WalletBar(): JSX.Element {
  const { connected, connecting, disconnect, publicKey } = useWallet();
  const [picking, setPicking] = useState(false);
  const [primaryName, setPrimaryName] = useState<string | null>(null);

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
      {picking && <WalletPicker onPicked={() => setPicking(false)} />}
    </>
  );
}

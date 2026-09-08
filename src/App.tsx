import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { useMemo } from "react";

import { WalletBar } from "./components/WalletBar";
import { useConnectOnSelect } from "./components/WalletPicker";
import { EXPLORER_URL, REPO_URL, RPC_URL, WS_URL } from "./lib/config";
import { About } from "./pages/About";
import { Create } from "./pages/Create";
import { Jar } from "./pages/Jar";
import { Pay } from "./pages/Pay";
import { useRoute, type Route } from "./router";

function Body(): JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case "pay":
      return <Pay payload={route.payload} />;
    case "jar":
      return <Jar recipient={route.recipient} />;
    case "about":
      return <About />;
    default:
      return <Create />;
  }
}

export function App(): JSX.Element {
  const route = useRoute();
  // No adapters are listed: Wallet Standard announces Nightly, Phantom, Solflare and Backpack to the
  // page, and WalletProvider picks up everything announced. Adding adapters here would only add a
  // second, staler copy of the same list.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed", wsEndpoint: WS_URL }}>
      <WalletProvider wallets={wallets} autoConnect>
        <Shell route={route} />
      </WalletProvider>
    </ConnectionProvider>
  );
}

/**
 * Inside the wallet provider, so the connect effect can reach it. The Pay page carries its own
 * connect action, which is the only thing that screen is for, so the header control is left off
 * there rather than offering the same thing twice.
 */
function Shell({ route }: { route: Route }): JSX.Element {
  useConnectOnSelect();
  const onPayPage = route.name === "pay";

  return (
        <div className="page">
          <header className="masthead">
            <a className="wordmark" href="#/">
              Cookie<span> Jar</span>
            </a>
            {!onPayPage && <WalletBar />}
          </header>
          {!onPayPage && (
            <nav className="nav">
              <a href="#/" aria-current={route.name === "create" ? "page" : undefined}>
                Create
              </a>
              <a href="#/about" aria-current={route.name === "about" ? "page" : undefined}>
                How it works
              </a>
            </nav>
          )}
          <main className="sheet">
            <Body />
          </main>
          <footer className="foot">
            <p>
              Payment links and tip jars on Cookie Chain. The request lives in the link, the receipt
              lives on chain. Nothing is stored on a server.
            </p>
            <p>
              RPC {new URL(RPC_URL).host} · explorer{" "}
              <a href={EXPLORER_URL}>{new URL(EXPLORER_URL).host}</a> · <a href={REPO_URL}>source</a>
            </p>
          </footer>
        </div>
  );
}

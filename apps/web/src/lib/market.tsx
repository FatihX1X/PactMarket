/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, http } from "viem";
import { emptySnapshot, syncMarket, type MarketSnapshot } from "@pact/chain";
import { appConfig, marketConfigured, pactChain } from "../config";

interface MarketState {
  snapshot: MarketSnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}
const fallbackMarket = "0x0000000000000000000000000000000000000000" as const;
const MarketContext = createContext<MarketState | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(() =>
    emptySnapshot(
      appConfig.chainId,
      appConfig.marketAddress ?? fallbackMarket,
      appConfig.deploymentBlock ?? 0n,
    ),
  );
  const [loading, setLoading] = useState(marketConfigured);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!marketConfigured || !appConfig.marketAddress || appConfig.deploymentBlock === null) return;
    let cancelled = false;
    setLoading(true);
    const client = createPublicClient({ chain: pactChain, transport: http(appConfig.rpcUrl) });
    syncMarket(client, appConfig.chainId, appConfig.marketAddress, appConfig.deploymentBlock)
      .then((value) => {
        if (!cancelled) {
          setSnapshot(value);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "RPC unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = useMemo(
    () => ({ snapshot, loading, error, refresh: () => setNonce((v) => v + 1) }),
    [snapshot, loading, error],
  );
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const value = useContext(MarketContext);
  if (!value) throw new Error("useMarket must be used inside MarketProvider");
  return value;
}

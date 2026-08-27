/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { emptyComputeSnapshot, syncComputeMarket, type ComputeMarketSnapshot } from "@pact/chain";
import { createPublicClient, http } from "viem";
import { appConfig, computeMarketConfigured, pactChain } from "../config";

interface ComputeMarketState {
  snapshot: ComputeMarketSnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const fallbackMarket = "0x0000000000000000000000000000000000000000" as const;
const ComputeMarketContext = createContext<ComputeMarketState | null>(null);

export function ComputeMarketProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(() =>
    emptyComputeSnapshot(
      appConfig.chainId,
      appConfig.computeMarketAddress ?? fallbackMarket,
      appConfig.computeDeploymentBlock ?? 0n,
    ),
  );
  const [loading, setLoading] = useState(computeMarketConfigured);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (
      !computeMarketConfigured ||
      !appConfig.computeMarketAddress ||
      appConfig.computeDeploymentBlock === null
    ) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const client = createPublicClient({ chain: pactChain, transport: http(appConfig.rpcUrl) });
    syncComputeMarket(
      client,
      appConfig.chainId,
      appConfig.computeMarketAddress,
      appConfig.computeDeploymentBlock,
    )
      .then((value) => {
        if (!cancelled) {
          setSnapshot(value);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Compute RPC unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = useMemo(
    () => ({ snapshot, loading, error, refresh: () => setNonce((current) => current + 1) }),
    [snapshot, loading, error],
  );
  return <ComputeMarketContext.Provider value={value}>{children}</ComputeMarketContext.Provider>;
}

export function useComputeMarket() {
  const value = useContext(ComputeMarketContext);
  if (!value) throw new Error("useComputeMarket must be used inside ComputeMarketProvider");
  return value;
}

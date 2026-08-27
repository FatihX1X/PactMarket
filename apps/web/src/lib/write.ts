import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { pactComputeMarketAbi, pactMarketAbi } from "@pact/chain";
import { appConfig, computeMarketConfigured, marketConfigured } from "../config";

export function usePactWrite() {
  const account = useAccount();
  const client = usePublicClient();
  const writer = useWriteContract();
  const [status, setStatus] = useState<string | null>(null);
  const run = async (functionName: string, args: readonly unknown[]) => {
    if (!marketConfigured || !appConfig.marketAddress)
      throw new Error("Base Sepolia deployment pending");
    if (!account.address) throw new Error("Connect a wallet first");
    if (account.chainId !== appConfig.chainId) throw new Error("Switch to the configured network");
    setStatus("Confirm in wallet…");
    const hash = await writer.writeContractAsync({
      address: appConfig.marketAddress,
      abi: pactMarketAbi,
      functionName: functionName as any,
      args: args as any,
    });
    setStatus("Waiting for confirmation…");
    await client!.waitForTransactionReceipt({ hash });
    setStatus("Confirmed");
    return hash;
  };
  return { run, status, error: writer.error?.message ?? null, pending: writer.isPending };
}

export function useComputeWrite() {
  const account = useAccount();
  const client = usePublicClient();
  const writer = useWriteContract();
  const [status, setStatus] = useState<string | null>(null);
  const run = async (functionName: string, args: readonly unknown[]) => {
    if (!computeMarketConfigured || !appConfig.computeMarketAddress) {
      throw new Error("Compute market deployment pending");
    }
    if (!account.address) throw new Error("Connect a wallet first");
    if (account.chainId !== appConfig.chainId) throw new Error("Switch to the configured network");
    setStatus("Confirm in wallet…");
    const hash = await writer.writeContractAsync({
      address: appConfig.computeMarketAddress,
      abi: pactComputeMarketAbi,
      functionName: functionName as any,
      args: args as any,
    });
    setStatus("Waiting for confirmation…");
    await client!.waitForTransactionReceipt({ hash });
    setStatus("Confirmed");
    return hash;
  };
  return { run, status, error: writer.error?.message ?? null, pending: writer.isPending };
}

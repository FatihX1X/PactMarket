export interface SettlementAdapterDescriptor {
  id: "base-usdc" | "flop-native";
  label: string;
  available: boolean;
  chainId?: number;
  tokenAddress?: `0x${string}`;
  contractAddress?: `0x${string}`;
  reason?: string;
  specificationUrl: string;
}

export function baseUsdcSettlement(input: {
  chainId: number;
  tokenAddress: `0x${string}`;
  contractAddress?: `0x${string}`;
}): SettlementAdapterDescriptor {
  return {
    id: "base-usdc",
    label: "Base USDC escrow",
    available: Boolean(input.contractAddress),
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    contractAddress: input.contractAddress,
    reason: input.contractAddress ? undefined : "PactComputeMarket deployment is not configured.",
    specificationUrl: "https://docs.base.org/base-chain/quickstart/connecting-to-base",
  };
}

export const flopNativeSettlement: SettlementAdapterDescriptor = {
  id: "flop-native",
  label: "FLOP-native compute settlement",
  available: false,
  reason:
    "Official FLOP testnet chain, transaction and proof interfaces are not final. No endpoint or token behavior is assumed.",
  specificationUrl: "https://flop.finance/teaser/",
};

export function requireAvailableSettlement(adapter: SettlementAdapterDescriptor): void {
  if (!adapter.available) throw new Error(adapter.reason ?? `${adapter.label} is unavailable.`);
}

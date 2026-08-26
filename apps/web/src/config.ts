import { defineChain, getAddress, isAddress } from "viem";

const numberValue = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const appConfig = {
  chainId: numberValue(import.meta.env.VITE_CHAIN_ID, 84532),
  rpcUrl: import.meta.env.VITE_RPC_URL?.trim() || "https://sepolia.base.org",
  marketAddress: isAddress(import.meta.env.VITE_MARKET_ADDRESS ?? "")
    ? getAddress(import.meta.env.VITE_MARKET_ADDRESS)
    : null,
  usdcAddress: isAddress(import.meta.env.VITE_USDC_ADDRESS ?? "")
    ? getAddress(import.meta.env.VITE_USDC_ADDRESS)
    : null,
  deploymentBlock: /^\d+$/.test(import.meta.env.VITE_DEPLOYMENT_BLOCK ?? "")
    ? BigInt(import.meta.env.VITE_DEPLOYMENT_BLOCK)
    : null,
  technocoreUrl: import.meta.env.VITE_TECHNOCORE_BASE_URL?.trim() || "https://technocore.chat",
  technocoreProxyUrl: import.meta.env.VITE_TECHNOCORE_PROXY_URL?.trim() || "",
};

export const marketConfigured = Boolean(
  appConfig.marketAddress && appConfig.usdcAddress && appConfig.deploymentBlock !== null,
);

export const pactChain = defineChain({
  id: appConfig.chainId,
  name: appConfig.chainId === 84532 ? "Base Sepolia" : `Pact chain ${appConfig.chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [appConfig.rpcUrl] } },
  blockExplorers: {
    default: {
      name: appConfig.chainId === 84532 ? "BaseScan" : "Explorer",
      url: appConfig.chainId === 84532 ? "https://sepolia.basescan.org" : "",
    },
  },
  testnet: appConfig.chainId !== 8453,
});

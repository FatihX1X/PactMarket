import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { appConfig, pactChain } from "./config";

export const wagmiConfig = createConfig({
  chains: [pactChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [pactChain.id]: http(appConfig.rpcUrl) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

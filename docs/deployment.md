# Deployment

## Local

Install Node 22+, pnpm 11.19 and stable Foundry, then:

```bash
pnpm install
forge build --root contracts
forge test --root contracts
anvil
```

In a second shell, seed MockUSDC, PactAgentMarket, three agents and five jobs.
The command prints every frontend environment value needed for the local chain:

```bash
pnpm --filter @pact/example-agent seed-local
pnpm dev
```

## Base Sepolia

The current Pact V1 deployment is:

- Network: Base Sepolia (`84532`)
- Market: `0xC5E634BBA75bB25758E15247E7C07Da889301584`
- Payment token: Circle test USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
- Deployment block: `46002591`
- Transaction: `0x4003df9e55fa22c80d8bb888ae8e415d7d5f652cd01f2f2c807bcbada3982da7`
- Source verification: [Sourcify exact match](https://repo.sourcify.dev/84532/0xC5E634BBA75bB25758E15247E7C07Da889301584)

The machine-readable record is in `deployments/base-sepolia.json`.

### Re-deployment

Re-check chain ID, RPC and Circle's Base Sepolia USDC address immediately before deployment. Keep `PRIVATE_KEY` outside tracked files.

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url "$BASE_SEPOLIA_RPC_URL"
forge script script/Deploy.s.sol:Deploy --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast --verify --etherscan-api-key "$BASESCAN_API_KEY"
```

Record the receipt, market address and deployment block. Confirm `paymentToken()`, deployed bytecode and explorer source verification before setting Vercel production values.

## Vercel

Connect GitHub repository `FatihX1X/PactMarket`; use `main` for Production and other branches for Preview. Repository-root settings are committed in `vercel.json`. Add only public `VITE_*` values. With no market address the app intentionally enters deployment-pending mode and disables writes.

The delivery workflow uses the pinned Vercel CLI version below. `.vercel` and
tokens are ignored and must remain local:

```bash
pnpm dlx vercel@59.5.0 login
pnpm dlx vercel@59.5.0 link
pnpm dlx vercel@59.5.0 deploy
pnpm dlx vercel@59.5.0 deploy --prod
```

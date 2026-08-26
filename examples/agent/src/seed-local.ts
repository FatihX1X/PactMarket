import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseUnits,
  publicActions,
  walletActions,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

type Artifact = { abi: Abi; bytecode: { object: Hex } };

const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const accountFor = (value: bigint) =>
  privateKeyToAccount(`0x${value.toString(16).padStart(64, "0")}` as Hex);
const alice = accountFor(1n);
const agentA = accountFor(2n);
const agentB = accountFor(3n);
const agentC = accountFor(4n);

async function artifact(contractName: string): Promise<Artifact> {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const file = resolve(repoRoot, `contracts/out/${contractName}.sol/${contractName}.json`);
  return JSON.parse(await readFile(file, "utf8")) as Artifact;
}

async function main() {
  const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpcUrl) })
    .extend(publicActions)
    .extend(walletActions);
  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  for (const account of [alice, agentA, agentB, agentC]) {
    await test.setBalance({ address: account.address, value: 10n ** 20n });
  }

  const deployer = createWalletClient({ account: alice, chain: foundry, transport: http(rpcUrl) });
  const usdcArtifact = await artifact("MockUSDC");
  const marketArtifact = await artifact("PactAgentMarket");
  const usdcHash = await deployer.deployContract({
    account: alice,
    abi: usdcArtifact.abi,
    bytecode: usdcArtifact.bytecode.object,
  });
  const usdc = (await publicClient.waitForTransactionReceipt({ hash: usdcHash })).contractAddress;
  if (!usdc) throw new Error("MockUSDC deployment did not return an address");
  const marketHash = await deployer.deployContract({
    account: alice,
    abi: marketArtifact.abi,
    bytecode: marketArtifact.bytecode.object,
    args: [usdc],
  });
  const marketReceipt = await publicClient.waitForTransactionReceipt({ hash: marketHash });
  const market = marketReceipt.contractAddress;
  if (!market) throw new Error("PactAgentMarket deployment did not return an address");

  const mintHash = await deployer.writeContract({
    account: alice,
    address: usdc,
    abi: usdcArtifact.abi,
    functionName: "mint",
    args: [alice.address, parseUnits("100", 6)],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  for (const [index, account] of [agentA, agentB, agentC].entries()) {
    const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
    const hash = await wallet.writeContract({
      account,
      address: market,
      abi: marketArtifact.abi,
      functionName: "registerAgent",
      args: [
        `Agent ${String.fromCharCode(65 + index)}`,
        `did:key:z6Mk${String(index + 1).repeat(44)}`,
        [["research"], ["typescript"], ["design"]][index]!,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const approveHash = await deployer.writeContract({
    account: alice,
    address: usdc,
    abi: usdcArtifact.abi,
    functionName: "approve",
    args: [market, parseUnits("50", 6)],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  const jobs = [
    ["Research Base markets", "Produce a sourced market brief.", 0],
    ["Review Solidity", "Audit lifecycle and escrow invariants.", 1],
    ["Build an AM1 bot", "Implement a documented protocol client.", 2],
    ["Design agent profile", "Create an accessible profile concept.", 3],
    ["Test Pact flows", "Run the end-to-end acceptance journey.", 4],
  ] as const;
  for (const [title, description, category] of jobs) {
    const hash = await deployer.writeContract({
      account: alice,
      address: market,
      abi: marketArtifact.abi,
      functionName: "createJob",
      args: [parseUnits("10", 6), deadline, 86_400n, title, description, category],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  console.log(
    JSON.stringify(
      {
        rpcUrl,
        market,
        usdc,
        deploymentBlock: marketReceipt.blockNumber.toString(),
        creator: alice.address,
        agents: [agentA.address, agentB.address, agentC.address],
        jobs: jobs.length,
      },
      null,
      2,
    ),
  );
}

await main();

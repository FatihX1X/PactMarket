import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseUnits,
  publicActions,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { pactComputeMarketAbi, pactMarketAbi } from "@pact/chain";
import {
  computeMessageHash,
  serializeBid,
  serializeComputeQuote,
  serializeComputeResult,
  serializeResult,
  messageHash,
} from "@pact/protocol";

type Artifact = { abi: Abi; bytecode: { object: Hex } };
type RoomMessage = { seq: number; ts: string; from: string; nonce: number; text: string };

const rpcUrl = "http://127.0.0.1:8545";
const expectedUsdc = "0xf2e246bb76df876cef8b38ae84130f4f55de395b" as const;
const expectedMarket = "0x2946259e0334f33a064106302415ad3391bed384" as const;
const expectedCompute = "0xde09e74d4888bc4e65f589e8c13bce9f71ddf4c7" as const;
const accountFor = (value: bigint) =>
  privateKeyToAccount(`0x${value.toString(16).padStart(64, "0")}` as Hex);
const alice = accountFor(1n);
const agentA = accountFor(2n);
const agentB = accountFor(3n);
const didA = "did:key:z6Mk11111111111111111111111111111111111111111111";
const didB = "did:key:z6Mk22222222222222222222222222222222222222222222";
let anvil: ChildProcess;

test.beforeAll(async () => {
  const windowsBinary = resolve(process.env.USERPROFILE ?? "", ".foundry/bin/anvil.exe");
  const command = process.env.ANVIL_BIN ?? (existsSync(windowsBinary) ? windowsBinary : "anvil");
  anvil = spawn(command, ["--silent", "--port", "8545", "--chain-id", "31337"], {
    stdio: "ignore",
  });
  await expect
    .poll(async () => {
      try {
        return await createPublicClient({ transport: http(rpcUrl) }).getChainId();
      } catch {
        return 0;
      }
    })
    .toBe(31337);
});

test.afterAll(() => anvil?.kill());

test("runs the Alice and Agent A/B escrow demo end to end", async ({ page }) => {
  test.setTimeout(90_000);
  const { usdc, market, computeMarket } = await deployDemo();
  expect(usdc.toLowerCase()).toBe(expectedUsdc);
  expect(market.toLowerCase()).toBe(expectedMarket);
  expect(computeMarket.toLowerCase()).toBe(expectedCompute);

  const bidA = serializeBid({
    type: "bid",
    chainId: 31337,
    market,
    jobId: "1",
    wallet: agentA.address,
    amount: "3000000",
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    proposal: "Agent A will produce the sourced research brief.",
  });
  const bidB = serializeBid({
    type: "bid",
    chainId: 31337,
    market,
    jobId: "1",
    wallet: agentB.address,
    amount: "4000000",
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    proposal: "Agent B can complete the same public brief.",
  });
  const roomMessages: RoomMessage[] = [
    { seq: 1, ts: new Date().toISOString(), from: didA, nonce: 1, text: bidA },
    { seq: 2, ts: new Date().toISOString(), from: didB, nonce: 2, text: bidB },
  ];
  await page.route("**/r/am-31337-1**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        room: "am-31337-1",
        count: roomMessages.length,
        first_seq: roomMessages[0]?.seq ?? null,
        last_seq: roomMessages.at(-1)?.seq ?? 0,
        messages: roomMessages,
      }),
    });
  });
  await installInjectedWallet(page, alice.address);

  await page.goto("/jobs/1");
  await expect(page.getByRole("heading", { name: "Research FLOP Finance" })).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("button", { name: /0x7E5F/i })).toBeVisible();
  await page.getByRole("button", { name: "Bids" }).click();
  await expect(page.getByText("3 USDC", { exact: true })).toBeVisible();
  await expect(page.getByText("4 USDC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accept bid" }).first().click();

  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  await expect.poll(async () => (await readJob(publicClient, market)).status).toBe(1);
  expect(
    await publicClient.readContract({
      address: usdc,
      abi: (await artifact("MockUSDC")).abi,
      functionName: "balanceOf",
      args: [alice.address],
    }),
  ).toBe(parseUnits("21", 6));

  const resultText = serializeResult({
    type: "result",
    chainId: 31337,
    market,
    jobId: "1",
    result: "Agent A completed the sourced research brief.",
    artifactUri: "",
    artifactHash: "",
    submittedAt: Math.floor(Date.now() / 1_000),
  });
  roomMessages.push({
    seq: 3,
    ts: new Date().toISOString(),
    from: didA,
    nonce: 3,
    text: resultText,
  });
  const agentWallet = createWalletClient({
    account: agentA,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const submitHash = await agentWallet.writeContract({
    address: market,
    abi: pactMarketAbi,
    functionName: "submitWork",
    args: [1n, messageHash(resultText)],
  });
  await publicClient.waitForTransactionReceipt({ hash: submitHash });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Research FLOP Finance" })).toBeVisible();
  await page.getByRole("button", { name: "Result" }).click();
  await expect(page.getByText("VERIFIED AGAINST ONCHAIN HASH")).toBeVisible();
  await page.screenshot({ path: "test-results/pact-demo.png", fullPage: true });
  await page.getByRole("button", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Accept & release USDC" }).click();
  await expect.poll(async () => (await readJob(publicClient, market)).status).toBe(3);

  await page.reload();
  await page.getByRole("button", { name: "Rate 5 of 5" }).click();
  await expect.poll(async () => (await readJob(publicClient, market)).rated).toBe(true);
  const stats = await publicClient.readContract({
    address: market,
    abi: pactMarketAbi,
    functionName: "getAgentStats",
    args: [agentA.address],
  });
  expect(stats.completedJobs).toBe(1n);
  expect(stats.totalEarned).toBe(parseUnits("3", 6));
  expect(stats.ratingSum).toBe(5n);

  const quote = serializeComputeQuote({
    type: "compute_quote",
    chainId: 31337,
    market: computeMarket,
    requestId: "1",
    wallet: agentA.address,
    price: "4000000",
    model: "llama-3",
    latencyMs: 900,
    capacity: 2,
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    proposal: "Public Llama inference on an A100 provider.",
  });
  const computeMessages: RoomMessage[] = [
    { seq: 1, ts: new Date().toISOString(), from: didA, nonce: 1, text: quote },
  ];
  await page.route("**/r/cm-31337-1**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        room: "cm-31337-1",
        count: computeMessages.length,
        first_seq: 1,
        last_seq: computeMessages.at(-1)?.seq ?? 0,
        messages: computeMessages,
      }),
    });
  });
  await page.goto("/compute/1");
  await expect(page.getByRole("heading", { name: "llama-3" })).toBeVisible();
  await page.getByRole("button", { name: "Quotes" }).click();
  await expect(page.getByText("LOWEST PRICE")).toBeVisible();
  await page.getByRole("button", { name: "Select provider" }).click();

  const outputHash = `0x${"42".repeat(32)}` as Hex;
  const computeResult = serializeComputeResult({
    type: "compute_result",
    chainId: 31337,
    market: computeMarket,
    requestId: "1",
    result: "Public inference completed.",
    artifactUri: "ipfs://public-result",
    artifactHash: `0x${"24".repeat(32)}`,
    outputHash,
    attestationHash: `0x${"00".repeat(32)}`,
    proofLevel: "self-attested",
    submittedAt: Math.floor(Date.now() / 1_000),
  });
  computeMessages.push({
    seq: 2,
    ts: new Date().toISOString(),
    from: didA,
    nonce: 2,
    text: computeResult,
  });
  await writeAndWait(agentWallet, publicClient, {
    address: computeMarket,
    abi: pactComputeMarketAbi,
    functionName: "submitComputeResult",
    args: [1n, computeMessageHash(computeResult), outputHash, `0x${"00".repeat(32)}`],
  });
  await page.reload();
  await page.getByRole("button", { name: "Result" }).click();
  await expect(page.getByText("MATCHES ONCHAIN COMMITMENTS")).toBeVisible();
  await page.screenshot({ path: "test-results/pact-compute-demo.png", fullPage: true });
  await page.getByRole("button", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Accept & release USDC" }).click();
  await expect.poll(async () => (await readCompute(publicClient, computeMarket)).status).toBe(3);
});

async function deployDemo(): Promise<{ usdc: Address; market: Address; computeMarket: Address }> {
  const testClient = createTestClient({
    chain: foundry,
    mode: "anvil",
    transport: http(rpcUrl),
  }).extend(publicActions);
  for (const account of [alice, agentA, agentB]) {
    await testClient.setBalance({ address: account.address, value: 10n ** 20n });
  }
  await testClient.impersonateAccount({ address: alice.address });
  const publicClient = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const deployer = createWalletClient({ account: alice, chain: foundry, transport: http(rpcUrl) });
  const usdcArtifact = await artifact("MockUSDC");
  const marketArtifact = await artifact("PactAgentMarket");
  const computeArtifact = await artifact("PactComputeMarket");
  const usdcHash = await deployer.deployContract({
    abi: usdcArtifact.abi,
    bytecode: usdcArtifact.bytecode.object,
  });
  const usdc = (await publicClient.waitForTransactionReceipt({ hash: usdcHash })).contractAddress!;
  const marketHash = await deployer.deployContract({
    abi: marketArtifact.abi,
    bytecode: marketArtifact.bytecode.object,
    args: [usdc],
  });
  const market = (await publicClient.waitForTransactionReceipt({ hash: marketHash }))
    .contractAddress!;
  const computeHash = await deployer.deployContract({
    abi: computeArtifact.abi,
    bytecode: computeArtifact.bytecode.object,
    args: [usdc],
  });
  const computeMarket = (await publicClient.waitForTransactionReceipt({ hash: computeHash }))
    .contractAddress!;
  await writeAndWait(deployer, publicClient, {
    address: usdc,
    abi: usdcArtifact.abi,
    functionName: "mint",
    args: [alice.address, parseUnits("30", 6)],
  });
  for (const [account, did, name] of [
    [agentA, didA, "Agent A"],
    [agentB, didB, "Agent B"],
  ] as const) {
    const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
    await writeAndWait(wallet, publicClient, {
      address: market,
      abi: marketArtifact.abi,
      functionName: "registerAgent",
      args: [name, did, ["research"]],
    });
    await writeAndWait(wallet, publicClient, {
      address: computeMarket,
      abi: computeArtifact.abi,
      functionName: "registerProvider",
      args: [name, did, ["llama-3"], "A100 80GB", "eu-west", parseUnits("2", 6), 2],
    });
  }
  await writeAndWait(deployer, publicClient, {
    address: usdc,
    abi: usdcArtifact.abi,
    functionName: "approve",
    args: [market, parseUnits("5", 6)],
  });
  await writeAndWait(deployer, publicClient, {
    address: market,
    abi: marketArtifact.abi,
    functionName: "createJob",
    args: [
      parseUnits("5", 6),
      BigInt(Math.floor(Date.now() / 1_000) + 86_400),
      7_200n,
      "Research FLOP Finance",
      "Produce a concise sourced report.",
      0,
    ],
  });
  await writeAndWait(deployer, publicClient, {
    address: usdc,
    abi: usdcArtifact.abi,
    functionName: "approve",
    args: [computeMarket, parseUnits("6", 6)],
  });
  await writeAndWait(deployer, publicClient, {
    address: computeMarket,
    abi: computeArtifact.abi,
    functionName: "createComputeRequest",
    args: [
      parseUnits("6", 6),
      BigInt(Math.floor(Date.now() / 1_000) + 86_400),
      7_200n,
      3_600n,
      1_500,
      `0x${"11".repeat(32)}`,
      `0x${"00".repeat(32)}`,
      0,
      "llama-3",
      "Summarize a public benchmark dataset.",
      "eu-west",
      false,
    ],
  });
  return { usdc, market, computeMarket };
}

async function artifact(contractName: string): Promise<Artifact> {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  return JSON.parse(
    await readFile(resolve(root, `contracts/out/${contractName}.sol/${contractName}.json`), "utf8"),
  ) as Artifact;
}

async function writeAndWait(
  wallet: ReturnType<typeof createWalletClient>,
  client: ReturnType<typeof createPublicClient>,
  request: Record<string, unknown>,
) {
  const hash = await wallet.writeContract(request as never);
  await client.waitForTransactionReceipt({ hash });
}

async function readJob(client: ReturnType<typeof createPublicClient>, market: Address) {
  return client.readContract({
    address: market,
    abi: pactMarketAbi,
    functionName: "getJob",
    args: [1n],
  });
}

async function readCompute(client: ReturnType<typeof createPublicClient>, market: Address) {
  return client.readContract({
    address: market,
    abi: pactComputeMarketAbi,
    functionName: "getRequest",
    args: [1n],
  });
}

async function installInjectedWallet(page: import("@playwright/test").Page, account: Address) {
  await page.addInitScript(
    ({ rpc, selected, chainId }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const provider = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [selected];
          if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "wallet_getCapabilities") return {};
          const response = await fetch(rpc, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
          });
          const json = await response.json();
          if (json.error) throw new Error(json.error.message);
          return json.result;
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const current = listeners.get(event) ?? new Set();
          current.add(listener);
          listeners.set(event, current);
        },
        removeListener: (event: string, listener: (...args: unknown[]) => void) =>
          listeners.get(event)?.delete(listener),
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    },
    { rpc: rpcUrl, selected: account, chainId: 31337 },
  );
}

import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import bs58 from "bs58";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToBytes,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pactMarketAbi } from "@pact/chain";
import {
  messageHash,
  roomName,
  serializeBid,
  serializeResult,
  technocoreSweep,
} from "@pact/protocol";
import { HttpTechnocoreClient } from "@pact/technocore";

const env = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const chainId = Number(env("CHAIN_ID"));
const rpcUrl = env("RPC_URL");
const market = getAddress(env("MARKET_ADDRESS"));
const deploymentBlock = BigInt(env("DEPLOYMENT_BLOCK"));
const technocoreUrl = process.env.TECHNOCORE_URL ?? "https://technocore.chat";
const didSeed = hexToBytes(env("AGENT_DID_PRIVATE_KEY") as `0x${string}`);
const evmKey = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

const publicKey = await getPublicKeyAsync(didSeed);
const did = `did:key:z${bs58.encode(Uint8Array.from([0xed, 0x01, ...publicKey]))}`;
const wallet = evmKey ? privateKeyToAccount(evmKey).address : getAddress(env("AGENT_WALLET"));
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const latest = await publicClient.getBlockNumber();
const logs = await publicClient.getLogs({
  address: market,
  fromBlock: deploymentBlock,
  toBlock: latest,
});
const created = parseEventLogs({ abi: pactMarketAbi, logs, eventName: "JobCreated" });
if (!created.length) throw new Error("No jobs discovered from Pact events");
const selected = created.at(-1)!;
const jobId = selected.args.jobId;
const room = roomName(chainId, jobId);
const job = await publicClient.readContract({
  address: market,
  abi: pactMarketAbi,
  functionName: "getJob",
  args: [jobId],
});
if (job.status !== 0) throw new Error("Selected job is not open");

const bidText = serializeBid({
  type: "bid",
  chainId,
  market,
  jobId: jobId.toString(),
  wallet,
  amount: process.env.BID_AMOUNT ?? (job.maxReward / 2n).toString(),
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  proposal: process.env.BID_PROPOSAL ?? "Protocol example bid; no LLM was called.",
});
const client = new HttpTechnocoreClient(technocoreUrl);
await sendSigned(client, room, did, didSeed, bidText);
console.log(`Signed bid sent to ${room}; bidHash=${messageHash(bidText)}`);

if (process.env.SEND_EXAMPLE_RESULT === "1") {
  const assigned = await publicClient.readContract({
    address: market,
    abi: pactMarketAbi,
    functionName: "getJob",
    args: [jobId],
  });
  if (assigned.worker.toLowerCase() !== wallet.toLowerCase())
    throw new Error("Agent is not the selected worker");
  const resultText = serializeResult({
    type: "result",
    chainId,
    market,
    jobId: jobId.toString(),
    result: process.env.EXAMPLE_RESULT ?? "Example protocol result.",
    artifactUri: "",
    artifactHash: "",
    submittedAt: Math.floor(Date.now() / 1000),
  });
  await sendSigned(client, room, did, didSeed, resultText);
  const hash = messageHash(resultText);
  console.log(`Signed result sent; resultHash=${hash}`);
  if (evmKey) {
    const walletClient = createWalletClient({
      account: privateKeyToAccount(evmKey),
      transport: http(rpcUrl),
    });
    const tx = await walletClient.writeContract({
      chain: null,
      address: market,
      abi: pactMarketAbi,
      functionName: "submitWork",
      args: [jobId, hash],
    });
    console.log(`submitWork transaction=${tx}`);
  }
}

async function sendSigned(
  client: HttpTechnocoreClient,
  room: string,
  did: string,
  seed: Uint8Array,
  text: string,
) {
  const nonce = String(Date.now());
  const swept = technocoreSweep(text);
  const signature = await signAsync(new TextEncoder().encode(`${room}|${nonce}|${swept}`), seed);
  const sig = Buffer.from(signature).toString("base64url");
  await client.sendSignedMessage(room, { did, sig, nonce, text: swept });
}

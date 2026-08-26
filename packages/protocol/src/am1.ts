import { getAddress, isAddress, keccak256, stringToHex } from "viem";
import {
  bidSchema,
  didKeyPattern,
  resultSchema,
  type Am1Bid,
  type Am1Message,
  type Am1Result,
  type RegisteredAgentIdentity,
  type SignedRoomMessage,
} from "./types";

export const AM1_PREFIX = "AM1|";
export const TECHNOCORE_MESSAGE_LIMIT = 4_096;

// Technocore replaces C0/C1 controls and Unicode format characters with spaces.
// eslint-disable-next-line no-control-regex
const forbidden = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;

export function technocoreSweep(value: string): string {
  return value.replace(forbidden, " ").trim();
}

export function roomName(chainId: number, jobId: bigint | string): string {
  const room = `am-${chainId}-${jobId.toString()}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) throw new Error("Invalid Technocore room name");
  return room;
}

export function serializeBid(bid: Am1Bid): string {
  const valid = bidSchema.parse(bid);
  return bounded(
    `${AM1_PREFIX}${JSON.stringify({
      type: valid.type,
      chainId: valid.chainId,
      market: getAddress(valid.market),
      jobId: valid.jobId,
      wallet: getAddress(valid.wallet),
      amount: valid.amount,
      expiresAt: valid.expiresAt,
      proposal: technocoreSweep(valid.proposal),
    })}`,
  );
}

export function serializeResult(result: Am1Result): string {
  const valid = resultSchema.parse(result);
  return bounded(
    `${AM1_PREFIX}${JSON.stringify({
      type: valid.type,
      chainId: valid.chainId,
      market: getAddress(valid.market),
      jobId: valid.jobId,
      result: technocoreSweep(valid.result),
      artifactUri: technocoreSweep(valid.artifactUri),
      artifactHash: valid.artifactHash,
      submittedAt: valid.submittedAt,
    })}`,
  );
}

export function parseAm1(text: string): Am1Message | null {
  if (!text.startsWith(AM1_PREFIX) || text.length > TECHNOCORE_MESSAGE_LIMIT) return null;
  try {
    const raw: unknown = JSON.parse(text.slice(AM1_PREFIX.length));
    if (typeof raw !== "object" || raw === null || !("type" in raw)) return null;
    return (raw as { type?: string }).type === "bid"
      ? bidSchema.parse(raw)
      : (raw as { type?: string }).type === "result"
        ? resultSchema.parse(raw)
        : null;
  } catch {
    return null;
  }
}

export function messageHash(text: string): `0x${string}` {
  return keccak256(stringToHex(technocoreSweep(text)));
}

export function isSignedLane(message: SignedRoomMessage): boolean {
  return didKeyPattern.test(message.from) && Number.isSafeInteger(message.nonce);
}

export function validateBid(
  message: SignedRoomMessage,
  expected: {
    chainId: number;
    market: `0x${string}`;
    jobId: bigint;
    maxReward: bigint;
    blockTimestamp: number;
    agents: RegisteredAgentIdentity[];
  },
): { bid: Am1Bid; hash: `0x${string}` } | null {
  if (!isSignedLane(message)) return null;
  const parsed = parseAm1(message.text);
  if (!parsed || parsed.type !== "bid" || !isAddress(parsed.market) || !isAddress(parsed.wallet))
    return null;
  const identity = expected.agents.find((agent) => agent.did === message.from);
  const amount = BigInt(parsed.amount);
  if (
    !identity ||
    getAddress(identity.wallet) !== getAddress(parsed.wallet) ||
    parsed.chainId !== expected.chainId ||
    getAddress(parsed.market) !== getAddress(expected.market) ||
    BigInt(parsed.jobId) !== expected.jobId ||
    amount <= 0n ||
    amount > expected.maxReward ||
    parsed.expiresAt <= expected.blockTimestamp
  )
    return null;
  return { bid: parsed, hash: messageHash(message.text) };
}

export function validateResult(
  message: SignedRoomMessage,
  expected: {
    chainId: number;
    market: `0x${string}`;
    jobId: bigint;
    worker: `0x${string}`;
    agents: RegisteredAgentIdentity[];
    onchainHash: `0x${string}`;
  },
): { result: Am1Result; verified: boolean } | null {
  if (!isSignedLane(message)) return null;
  const parsed = parseAm1(message.text);
  if (!parsed || parsed.type !== "result" || !isAddress(parsed.market)) return null;
  const identity = expected.agents.find((agent) => agent.did === message.from);
  if (
    !identity ||
    getAddress(identity.wallet) !== getAddress(expected.worker) ||
    parsed.chainId !== expected.chainId ||
    getAddress(parsed.market) !== getAddress(expected.market) ||
    BigInt(parsed.jobId) !== expected.jobId
  )
    return null;
  return { result: parsed, verified: messageHash(message.text) === expected.onchainHash };
}

function bounded(value: string): string {
  const swept = technocoreSweep(value);
  if (!swept || swept.length > TECHNOCORE_MESSAGE_LIMIT)
    throw new Error("AM1 message exceeds Technocore limit");
  return swept;
}

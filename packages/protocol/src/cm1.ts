import { getAddress, isAddress, keccak256, stringToHex } from "viem";
import { z } from "zod";
import {
  decimalPattern,
  didKeyPattern,
  type RegisteredAgentIdentity,
  type SignedRoomMessage,
} from "./types";
import { isSignedLane, technocoreSweep, TECHNOCORE_MESSAGE_LIMIT } from "./am1";

export const CM1_PREFIX = "CM1|";
export const proofLevels = ["self-attested", "external-attested", "flop-native"] as const;
export type ComputeProofLevel = (typeof proofLevels)[number];

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const optionalHashPattern = /^(|0x[0-9a-fA-F]{64})$/;

export const computeQuoteSchema = z.object({
  type: z.literal("compute_quote"),
  chainId: z.number().int().positive(),
  market: z.string(),
  requestId: z.string().regex(decimalPattern),
  wallet: z.string(),
  price: z.string().regex(decimalPattern),
  model: z.string().min(1).max(96),
  latencyMs: z.number().int().positive(),
  capacity: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  proposal: z.string().min(1).max(2_000),
});

export const computeResultSchema = z.object({
  type: z.literal("compute_result"),
  chainId: z.number().int().positive(),
  market: z.string(),
  requestId: z.string().regex(decimalPattern),
  result: z.string().max(3_000),
  artifactUri: z.string().max(1_000),
  artifactHash: z.string().regex(optionalHashPattern),
  outputHash: z.string().regex(hashPattern),
  attestationHash: z.string().regex(optionalHashPattern),
  proofLevel: z.enum(proofLevels),
  submittedAt: z.number().int().positive(),
});

export type ComputeQuote = z.infer<typeof computeQuoteSchema>;
export type ComputeResult = z.infer<typeof computeResultSchema>;
export type Cm1Message = ComputeQuote | ComputeResult;

export interface RegisteredComputeProvider extends RegisteredAgentIdentity {
  modelFamilies: string[];
  minimumPrice: bigint;
  capacity: number;
  active: boolean;
}

export function computeRoomName(chainId: number, requestId: bigint | string): string {
  const room = `cm-${chainId}-${requestId.toString()}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) {
    throw new Error("Invalid Technocore compute room name");
  }
  return room;
}

export function serializeComputeQuote(quote: ComputeQuote): string {
  const valid = computeQuoteSchema.parse(quote);
  return bounded(
    `${CM1_PREFIX}${JSON.stringify({
      type: valid.type,
      chainId: valid.chainId,
      market: getAddress(valid.market),
      requestId: valid.requestId,
      wallet: getAddress(valid.wallet),
      price: valid.price,
      model: technocoreSweep(valid.model),
      latencyMs: valid.latencyMs,
      capacity: valid.capacity,
      expiresAt: valid.expiresAt,
      proposal: technocoreSweep(valid.proposal),
    })}`,
  );
}

export function serializeComputeResult(result: ComputeResult): string {
  const valid = computeResultSchema.parse(result);
  return bounded(
    `${CM1_PREFIX}${JSON.stringify({
      type: valid.type,
      chainId: valid.chainId,
      market: getAddress(valid.market),
      requestId: valid.requestId,
      result: technocoreSweep(valid.result),
      artifactUri: technocoreSweep(valid.artifactUri),
      artifactHash: valid.artifactHash,
      outputHash: valid.outputHash,
      attestationHash: valid.attestationHash,
      proofLevel: valid.proofLevel,
      submittedAt: valid.submittedAt,
    })}`,
  );
}

export function parseCm1(text: string): Cm1Message | null {
  if (!text.startsWith(CM1_PREFIX) || text.length > TECHNOCORE_MESSAGE_LIMIT) return null;
  try {
    const raw: unknown = JSON.parse(text.slice(CM1_PREFIX.length));
    if (typeof raw !== "object" || raw === null || !("type" in raw)) return null;
    return (raw as { type?: string }).type === "compute_quote"
      ? computeQuoteSchema.parse(raw)
      : (raw as { type?: string }).type === "compute_result"
        ? computeResultSchema.parse(raw)
        : null;
  } catch {
    return null;
  }
}

export function computeMessageHash(text: string): `0x${string}` {
  return keccak256(stringToHex(technocoreSweep(text)));
}

export function validateComputeQuote(
  message: SignedRoomMessage,
  expected: {
    chainId: number;
    market: `0x${string}`;
    requestId: bigint;
    maxBudget: bigint;
    maxLatencyMs: number;
    modelRef: string;
    blockTimestamp: number;
    providers: RegisteredComputeProvider[];
  },
): { quote: ComputeQuote; hash: `0x${string}` } | null {
  if (!isSignedLane(message)) return null;
  const parsed = parseCm1(message.text);
  if (!parsed || parsed.type !== "compute_quote") return null;
  if (!isAddress(parsed.market) || !isAddress(parsed.wallet)) return null;
  const provider = expected.providers.find((item) => item.did === message.from);
  const price = BigInt(parsed.price);
  const supportsModel = provider?.modelFamilies.some((family) =>
    parsed.model.toLowerCase().startsWith(family.toLowerCase()),
  );
  if (
    !provider ||
    !provider.active ||
    getAddress(provider.wallet) !== getAddress(parsed.wallet) ||
    parsed.chainId !== expected.chainId ||
    getAddress(parsed.market) !== getAddress(expected.market) ||
    BigInt(parsed.requestId) !== expected.requestId ||
    parsed.model !== expected.modelRef ||
    !supportsModel ||
    parsed.capacity > provider.capacity ||
    parsed.latencyMs > expected.maxLatencyMs ||
    price <= 0n ||
    price < provider.minimumPrice ||
    price > expected.maxBudget ||
    parsed.expiresAt <= expected.blockTimestamp
  ) {
    return null;
  }
  return { quote: parsed, hash: computeMessageHash(message.text) };
}

export function validateComputeResult(
  message: SignedRoomMessage,
  expected: {
    chainId: number;
    market: `0x${string}`;
    requestId: bigint;
    provider: `0x${string}`;
    providerDidHash: `0x${string}`;
    requiredProof: ComputeProofLevel;
    onchainHash: `0x${string}`;
    outputHash: `0x${string}`;
    attestationHash: `0x${string}`;
  },
): { result: ComputeResult; verified: boolean } | null {
  if (!isSignedLane(message)) return null;
  const parsed = parseCm1(message.text);
  if (!parsed || parsed.type !== "compute_result" || !isAddress(parsed.market)) return null;
  if (
    keccak256(stringToHex(message.from)).toLowerCase() !== expected.providerDidHash.toLowerCase() ||
    getAddress(parsed.market) !== getAddress(expected.market) ||
    parsed.chainId !== expected.chainId ||
    BigInt(parsed.requestId) !== expected.requestId ||
    parsed.proofLevel !== expected.requiredProof ||
    parsed.outputHash.toLowerCase() !== expected.outputHash.toLowerCase() ||
    (parsed.attestationHash || zeroHash()).toLowerCase() !== expected.attestationHash.toLowerCase()
  ) {
    return null;
  }
  return { result: parsed, verified: computeMessageHash(message.text) === expected.onchainHash };
}

export function isDidKey(value: string): boolean {
  return didKeyPattern.test(value);
}

function bounded(value: string): string {
  const swept = technocoreSweep(value);
  if (!swept || swept.length > TECHNOCORE_MESSAGE_LIMIT) {
    throw new Error("CM1 message exceeds Technocore limit");
  }
  return swept;
}

function zeroHash(): `0x${string}` {
  return `0x${"0".repeat(64)}`;
}

export const computeRequestStatuses = [
  "Open",
  "Assigned",
  "Submitted",
  "Completed",
  "Cancelled",
  "Refunded",
  "Abandoned",
] as const;

export const computeProofLevels = ["self-attested", "external-attested", "flop-native"] as const;

export type ComputeRequestStatus = (typeof computeRequestStatuses)[number];
export type ComputeProofLevel = (typeof computeProofLevels)[number];

export interface ComputeRequestRecord {
  id: bigint;
  buyer: `0x${string}`;
  provider?: `0x${string}`;
  maxBudget: bigint;
  agreedPrice: bigint;
  quoteDeadline: number;
  workDuration: number;
  workDeadline?: number;
  submittedAt?: number;
  reviewPeriod: number;
  maxLatencyMs: number;
  metadataHash: `0x${string}`;
  requirementsHash: `0x${string}`;
  expectedOutputHash: `0x${string}`;
  providerDidHash?: `0x${string}`;
  acceptedQuoteHash?: `0x${string}`;
  resultHash?: `0x${string}`;
  outputHash?: `0x${string}`;
  attestationHash?: `0x${string}`;
  requiredProof: ComputeProofLevel;
  modelRef: string;
  workload: string;
  region: string;
  status: ComputeRequestStatus;
  rated: boolean;
  createdBlock: bigint;
}

export interface ComputeProviderProfile {
  wallet: `0x${string}`;
  didHash: `0x${string}`;
  displayName: string;
  did: string;
  modelFamilies: string[];
  hardwareClass: string;
  region: string;
  minimumPrice: bigint;
  capacity: number;
  active: boolean;
  completedRequests: bigint;
  totalEarned: bigint;
  ratingCount: bigint;
  ratingSum: bigint;
}

export interface ComputeMarketSnapshot {
  chainId: number;
  market: `0x${string}`;
  syncedTo: bigint;
  requests: ComputeRequestRecord[];
  providers: ComputeProviderProfile[];
}

export const emptyComputeSnapshot = (
  chainId: number,
  market: `0x${string}`,
  block: bigint,
): ComputeMarketSnapshot => ({ chainId, market, syncedTo: block, requests: [], providers: [] });

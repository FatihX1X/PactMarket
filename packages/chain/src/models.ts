export const jobStatuses = [
  "Open",
  "Assigned",
  "Submitted",
  "Completed",
  "Cancelled",
  "Refunded",
  "Abandoned",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export interface MarketJob {
  id: bigint;
  creator: `0x${string}`;
  worker?: `0x${string}`;
  maxReward: bigint;
  agreedReward: bigint;
  applicationDeadline: number;
  workDuration: number;
  workDeadline?: number;
  metadataHash: `0x${string}`;
  workerDidHash?: `0x${string}`;
  acceptedBidHash?: `0x${string}`;
  resultHash?: `0x${string}`;
  title: string;
  description: string;
  category: number;
  status: JobStatus;
  rated: boolean;
  createdBlock: bigint;
}

export interface AgentProfile {
  wallet: `0x${string}`;
  didHash: `0x${string}`;
  displayName: string;
  did: string;
  skills: string[];
  completedJobs: bigint;
  totalEarned: bigint;
  ratingCount: bigint;
  ratingSum: bigint;
  signedActivityObserved: boolean;
}

export interface MarketSnapshot {
  chainId: number;
  market: `0x${string}`;
  syncedTo: bigint;
  jobs: MarketJob[];
  agents: AgentProfile[];
}

export const emptySnapshot = (
  chainId: number,
  market: `0x${string}`,
  block: bigint,
): MarketSnapshot => ({ chainId, market, syncedTo: block, jobs: [], agents: [] });

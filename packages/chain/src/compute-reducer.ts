import { decodeEventLog, type Log } from "viem";
import { pactComputeMarketAbi } from "./compute-abi";
import {
  computeProofLevels,
  emptyComputeSnapshot,
  type ComputeMarketSnapshot,
  type ComputeProviderProfile,
} from "./compute-models";

export function reduceComputeMarketLogs(
  chainId: number,
  market: `0x${string}`,
  fromBlock: bigint,
  logs: Log[],
): ComputeMarketSnapshot {
  const snapshot = emptyComputeSnapshot(chainId, market, fromBlock);
  for (const log of logs) {
    let decoded: ReturnType<typeof decodeEventLog>;
    try {
      decoded = decodeEventLog({ abi: pactComputeMarketAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const args = decoded.args as Record<string, any>;
    if (
      decoded.eventName === "ProviderRegistered" ||
      decoded.eventName === "ProviderProfileUpdated"
    ) {
      const existing = snapshot.providers.find(
        (provider) => provider.wallet.toLowerCase() === String(args.provider).toLowerCase(),
      );
      const profile: ComputeProviderProfile = {
        wallet: args.provider,
        didHash: args.didHash,
        displayName: args.displayName,
        did: args.did,
        modelFamilies: [...args.modelFamilies],
        hardwareClass: args.hardwareClass,
        region: args.region,
        minimumPrice: args.minimumPrice,
        capacity: Number(args.capacity),
        active: "active" in args ? Boolean(args.active) : true,
        completedRequests: existing?.completedRequests ?? 0n,
        totalEarned: existing?.totalEarned ?? 0n,
        ratingCount: existing?.ratingCount ?? 0n,
        ratingSum: existing?.ratingSum ?? 0n,
      };
      if (existing) Object.assign(existing, profile);
      else snapshot.providers.push(profile);
    } else if (decoded.eventName === "ComputeRequestCreated") {
      snapshot.requests.push({
        id: args.requestId,
        buyer: args.buyer,
        maxBudget: args.maxBudget,
        agreedPrice: 0n,
        quoteDeadline: Number(args.quoteDeadline),
        workDuration: Number(args.workDuration),
        reviewPeriod: Number(args.reviewPeriod),
        maxLatencyMs: Number(args.maxLatencyMs),
        metadataHash: args.metadataHash,
        requirementsHash: args.requirementsHash,
        expectedOutputHash: args.expectedOutputHash,
        requiredProof: computeProofLevels[Number(args.requiredProof)] ?? "self-attested",
        modelRef: args.modelRef,
        workload: args.workload,
        region: args.region,
        status: "Open",
        rated: false,
        createdBlock: log.blockNumber ?? 0n,
      });
    } else {
      const request = snapshot.requests.find((item) => item.id === args.requestId);
      if (!request) continue;
      if (decoded.eventName === "ProviderSelected") {
        Object.assign(request, {
          provider: args.provider,
          providerDidHash: args.providerDidHash,
          agreedPrice: args.agreedPrice,
          acceptedQuoteHash: args.quoteHash,
          workDeadline: Number(args.workDeadline),
          status: "Assigned",
        });
      } else if (decoded.eventName === "ComputeResultSubmitted") {
        Object.assign(request, {
          resultHash: args.resultHash,
          outputHash: args.outputHash,
          attestationHash: args.attestationHash,
          status: "Submitted",
        });
      } else if (decoded.eventName === "ComputeRequestCompleted") {
        request.status = "Completed";
        const provider = snapshot.providers.find(
          (item) => item.wallet.toLowerCase() === String(args.provider).toLowerCase(),
        );
        if (provider) {
          provider.completedRequests += 1n;
          provider.totalEarned += args.payment;
        }
      } else if (decoded.eventName === "ProviderRated") {
        request.rated = true;
        const provider = snapshot.providers.find(
          (item) => item.wallet.toLowerCase() === String(args.provider).toLowerCase(),
        );
        if (provider) {
          provider.ratingCount += 1n;
          provider.ratingSum += BigInt(args.rating);
        }
      } else if (decoded.eventName === "ComputeRequestCancelled") request.status = "Cancelled";
      else if (decoded.eventName === "ComputeRequestRefunded") request.status = "Refunded";
      else if (decoded.eventName === "ComputeRequestAbandoned") request.status = "Abandoned";
    }
    if (log.blockNumber && log.blockNumber > snapshot.syncedTo) snapshot.syncedTo = log.blockNumber;
  }
  return snapshot;
}

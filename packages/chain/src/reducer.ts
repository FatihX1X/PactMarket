import { decodeEventLog, type Log } from "viem";
import { pactMarketAbi } from "./abi";
import { emptySnapshot, type AgentProfile, type MarketSnapshot } from "./models";

export function reduceMarketLogs(
  chainId: number,
  market: `0x${string}`,
  fromBlock: bigint,
  logs: Log[],
): MarketSnapshot {
  const snapshot = emptySnapshot(chainId, market, fromBlock);
  for (const log of logs) {
    let decoded: any;
    try {
      decoded = decodeEventLog({ abi: pactMarketAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const a = decoded.args as any;
    if (decoded.eventName === "AgentRegistered" || decoded.eventName === "AgentProfileUpdated") {
      const profile: AgentProfile = {
        wallet: a.wallet,
        didHash: a.didHash,
        displayName: a.displayName,
        did: a.did,
        skills: [...a.skills],
        completedJobs: 0n,
        totalEarned: 0n,
        ratingCount: 0n,
        ratingSum: 0n,
        signedActivityObserved: false,
      };
      const existing = snapshot.agents.findIndex(
        (agent) => agent.wallet.toLowerCase() === profile.wallet.toLowerCase(),
      );
      if (existing >= 0)
        snapshot.agents[existing] = {
          ...profile,
          completedJobs: snapshot.agents[existing]!.completedJobs,
          totalEarned: snapshot.agents[existing]!.totalEarned,
          ratingCount: snapshot.agents[existing]!.ratingCount,
          ratingSum: snapshot.agents[existing]!.ratingSum,
          signedActivityObserved: snapshot.agents[existing]!.signedActivityObserved,
        };
      else snapshot.agents.push(profile);
    } else if (decoded.eventName === "JobCreated") {
      snapshot.jobs.push({
        id: a.jobId,
        creator: a.creator,
        maxReward: a.maxReward,
        agreedReward: 0n,
        applicationDeadline: Number(a.applicationDeadline),
        workDuration: Number(a.workDuration),
        metadataHash: a.metadataHash,
        title: a.title,
        description: a.description,
        category: Number(a.category),
        status: "Open",
        rated: false,
        createdBlock: log.blockNumber ?? 0n,
      });
    } else {
      const job = snapshot.jobs.find((item) => item.id === a.jobId);
      if (!job) continue;
      if (decoded.eventName === "WorkerAssigned") {
        Object.assign(job, {
          worker: a.worker,
          workerDidHash: a.workerDidHash,
          agreedReward: a.agreedReward,
          acceptedBidHash: a.bidHash,
          workDeadline: Number(a.workDeadline),
          status: "Assigned",
        });
      } else if (decoded.eventName === "WorkSubmitted") {
        Object.assign(job, { resultHash: a.resultHash, status: "Submitted" });
      } else if (decoded.eventName === "JobCompleted") {
        job.status = "Completed";
        const agent = snapshot.agents.find(
          (item) => item.wallet.toLowerCase() === String(a.worker).toLowerCase(),
        );
        if (agent) {
          agent.completedJobs += 1n;
          agent.totalEarned += a.payment;
        }
      } else if (decoded.eventName === "WorkerRated") {
        job.rated = true;
        const agent = snapshot.agents.find(
          (item) => item.wallet.toLowerCase() === String(a.worker).toLowerCase(),
        );
        if (agent) {
          agent.ratingCount += 1n;
          agent.ratingSum += BigInt(a.rating);
        }
      } else if (decoded.eventName === "JobCancelled") job.status = "Cancelled";
      else if (decoded.eventName === "JobRefunded") job.status = "Refunded";
      else if (decoded.eventName === "WorkAbandoned") job.status = "Abandoned";
    }
    if (log.blockNumber && log.blockNumber > snapshot.syncedTo) snapshot.syncedTo = log.blockNumber;
  }
  return snapshot;
}

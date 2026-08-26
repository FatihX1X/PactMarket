import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { retainBeforeReorgWindow } from "./indexer";
import { reduceMarketLogs } from "./reducer";

const market = "0x1111111111111111111111111111111111111111" as const;
const creator = "0x2222222222222222222222222222222222222222" as const;
const metadataHash = `0x${"33".repeat(32)}` as const;
const event = parseAbiItem(
  "event JobCreated(uint256 indexed jobId,address indexed creator,uint256 maxReward,uint64 applicationDeadline,uint64 workDuration,bytes32 metadataHash,string title,string description,uint8 category)",
);

describe("market event projection", () => {
  it("reconstructs a job from an onchain event", () => {
    const topics = encodeEventTopics({
      abi: [event],
      eventName: "JobCreated",
      args: { jobId: 7n, creator },
    });
    const data = encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "uint8" },
      ],
      [5_000_000n, 2_000_000_000n, 3_600n, metadataHash, "Research", "Sourced report", 2],
    );
    const snapshot = reduceMarketLogs(84532, market, 100n, [
      {
        address: market,
        topics,
        data,
        blockNumber: 123n,
        blockHash: null,
        logIndex: 0,
        transactionHash: null,
        transactionIndex: 0,
        removed: false,
      } as Log,
    ]);
    expect(snapshot.syncedTo).toBe(123n);
    expect(snapshot.jobs[0]).toMatchObject({ id: 7n, title: "Research", status: "Open" });
  });

  it("drops cached logs inside the reorg overlap before rescanning", () => {
    const logs = [100n, 127n, 128n, 129n].map((blockNumber) => ({ blockNumber }) as Log);
    expect(retainBeforeReorgWindow(logs, 128n).map((log) => log.blockNumber)).toEqual([100n, 127n]);
  });
});

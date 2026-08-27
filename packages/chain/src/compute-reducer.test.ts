import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { reduceComputeMarketLogs } from "./compute-reducer";

const market = "0x1111111111111111111111111111111111111111" as const;
const buyer = "0x2222222222222222222222222222222222222222" as const;
const metadataHash = `0x${"33".repeat(32)}` as const;
const requirementsHash = `0x${"44".repeat(32)}` as const;
const zeroHash = `0x${"00".repeat(32)}` as const;
const event = parseAbiItem(
  "event ComputeRequestCreated(uint256 indexed requestId,address indexed buyer,uint256 maxBudget,uint64 quoteDeadline,uint64 workDuration,uint64 reviewPeriod,uint32 maxLatencyMs,bytes32 metadataHash,bytes32 requirementsHash,bytes32 expectedOutputHash,uint8 requiredProof,string modelRef,string workload,string region)",
);

describe("compute market event projection", () => {
  it("reconstructs a compute request from its canonical event", () => {
    const topics = encodeEventTopics({
      abi: [event],
      eventName: "ComputeRequestCreated",
      args: { requestId: 9n, buyer },
    });
    const data = encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        5_000_000n,
        2_000_000_000n,
        3_600n,
        7_200n,
        2_000,
        metadataHash,
        requirementsHash,
        zeroHash,
        0,
        "llama-3.1-8b",
        "Public inference",
        "eu-west",
      ],
    );
    const snapshot = reduceComputeMarketLogs(84532, market, 100n, [
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
    expect(snapshot.requests[0]).toMatchObject({
      id: 9n,
      modelRef: "llama-3.1-8b",
      requiredProof: "self-attested",
      status: "Open",
    });
  });
});

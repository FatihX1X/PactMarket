import { describe, expect, it } from "vitest";
import {
  messageHash,
  parseAm1,
  roomName,
  serializeBid,
  serializeResult,
  technocoreSweep,
  validateBid,
  validateResult,
} from "./am1";

const MARKET = "0x1111111111111111111111111111111111111111" as const;
const WALLET = "0x2222222222222222222222222222222222222222" as const;
const DID = "did:key:z6Mk11111111111111111111111111111111111111111111";

describe("AM1", () => {
  it("serializes canonical bids", () => {
    const text = serializeBid({
      type: "bid",
      chainId: 84532,
      market: MARKET,
      jobId: "42",
      wallet: WALLET,
      amount: "7000000",
      expiresAt: 1_900_000_000,
      proposal: "Ship it",
    });
    expect(text).toBe(
      `AM1|{"type":"bid","chainId":84532,"market":"${MARKET}","jobId":"42","wallet":"${WALLET}","amount":"7000000","expiresAt":1900000000,"proposal":"Ship it"}`,
    );
    expect(parseAm1(text)?.type).toBe("bid");
  });

  it("derives valid rooms and sweeps invisible input", () => {
    expect(roomName(84532, 42n)).toBe("am-84532-42");
    expect(technocoreSweep("hello\nworld\u200b")).toBe("hello world");
  });

  it("accepts only signed registered bids", () => {
    const text = serializeBid({
      type: "bid",
      chainId: 84532,
      market: MARKET,
      jobId: "42",
      wallet: WALLET,
      amount: "7",
      expiresAt: 200,
      proposal: "ok",
    });
    const valid = validateBid(
      { seq: 1, ts: "now", from: DID, nonce: 1, text },
      {
        chainId: 84532,
        market: MARKET,
        jobId: 42n,
        maxReward: 10n,
        blockTimestamp: 100,
        agents: [{ wallet: WALLET, did: DID }],
      },
    );
    expect(valid?.hash).toBe(messageHash(text));
    expect(
      validateBid(
        { seq: 1, ts: "now", from: "bot", text },
        {
          chainId: 84532,
          market: MARKET,
          jobId: 42n,
          maxReward: 10n,
          blockTimestamp: 100,
          agents: [],
        },
      ),
    ).toBeNull();
  });

  it("binds result integrity to the selected worker DID and wallet", () => {
    const text = serializeResult({
      type: "result",
      chainId: 84532,
      market: MARKET,
      jobId: "42",
      result: "done",
      artifactUri: "",
      artifactHash: "",
      submittedAt: 200,
    });
    const expected = {
      chainId: 84532,
      market: MARKET,
      jobId: 42n,
      worker: WALLET,
      agents: [{ wallet: WALLET, did: DID }],
      onchainHash: messageHash(text),
    };
    expect(
      validateResult({ seq: 2, ts: "now", from: DID, nonce: 2, text }, expected)?.verified,
    ).toBe(true);
    expect(
      validateResult({ seq: 2, ts: "now", from: `${DID.slice(0, -1)}2`, nonce: 2, text }, expected),
    ).toBeNull();
  });
});

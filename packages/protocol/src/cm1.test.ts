import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import {
  computeMessageHash,
  computeRoomName,
  parseCm1,
  serializeComputeQuote,
  serializeComputeResult,
  validateComputeQuote,
  validateComputeResult,
} from "./cm1";

const MARKET = "0x1111111111111111111111111111111111111111" as const;
const WALLET = "0x2222222222222222222222222222222222222222" as const;
const DID = "did:key:z6Mk11111111111111111111111111111111111111111111";
const OUTPUT = `0x${"12".repeat(32)}` as const;
const ZERO = `0x${"0".repeat(64)}` as const;

describe("CM1 compute protocol", () => {
  it("serializes quotes in canonical order and sweeps hidden controls", () => {
    const text = serializeComputeQuote({
      type: "compute_quote",
      chainId: 84532,
      market: MARKET,
      requestId: "7",
      wallet: WALLET,
      price: "2500000",
      model: "llama-3.1-8b",
      latencyMs: 1800,
      capacity: 2,
      expiresAt: 2_000_000_000,
      proposal: "public\u200b inference",
    });
    expect(text).toBe(
      `CM1|{"type":"compute_quote","chainId":84532,"market":"${MARKET}","requestId":"7","wallet":"${WALLET}","price":"2500000","model":"llama-3.1-8b","latencyMs":1800,"capacity":2,"expiresAt":2000000000,"proposal":"public  inference"}`,
    );
    expect(parseCm1(text)?.type).toBe("compute_quote");
    expect(computeRoomName(84532, 7n)).toBe("cm-84532-7");
  });

  it("accepts only capable registered providers within budget and latency", () => {
    const text = serializeComputeQuote({
      type: "compute_quote",
      chainId: 84532,
      market: MARKET,
      requestId: "7",
      wallet: WALLET,
      price: "2500000",
      model: "llama-3.1-8b",
      latencyMs: 1800,
      capacity: 2,
      expiresAt: 2_000_000_000,
      proposal: "Run the public benchmark.",
    });
    const expected = {
      chainId: 84532,
      market: MARKET,
      requestId: 7n,
      maxBudget: 3_000_000n,
      maxLatencyMs: 2_000,
      modelRef: "llama-3.1-8b",
      blockTimestamp: 1_900_000_000,
      providers: [
        {
          wallet: WALLET,
          did: DID,
          modelFamilies: ["llama-3"],
          minimumPrice: 2_000_000n,
          capacity: 4,
          active: true,
        },
      ],
    };
    expect(
      validateComputeQuote({ seq: 1, ts: "now", from: DID, nonce: 1, text }, expected)?.hash,
    ).toBe(computeMessageHash(text));
    expect(validateComputeQuote({ seq: 1, ts: "now", from: DID, text }, expected)).toBeNull();
    expect(
      validateComputeQuote(
        { seq: 1, ts: "now", from: DID, nonce: 1, text },
        { ...expected, maxLatencyMs: 1_000 },
      ),
    ).toBeNull();
  });

  it("binds result, proof level and output hashes to the selected provider", () => {
    const text = serializeComputeResult({
      type: "compute_result",
      chainId: 84532,
      market: MARKET,
      requestId: "7",
      result: "Inference complete.",
      artifactUri: "https://example.com/result.json",
      artifactHash: OUTPUT,
      outputHash: OUTPUT,
      attestationHash: "",
      proofLevel: "self-attested",
      submittedAt: 1_900_000_100,
    });
    const validated = validateComputeResult(
      { seq: 2, ts: "now", from: DID, nonce: 2, text },
      {
        chainId: 84532,
        market: MARKET,
        requestId: 7n,
        provider: WALLET,
        providerDidHash: keccak256(stringToHex(DID)),
        requiredProof: "self-attested",
        onchainHash: computeMessageHash(text),
        outputHash: OUTPUT,
        attestationHash: ZERO,
      },
    );
    expect(validated?.verified).toBe(true);
    expect(
      validateComputeResult(
        { seq: 2, ts: "now", from: `${DID.slice(0, -1)}2`, nonce: 2, text },
        {
          chainId: 84532,
          market: MARKET,
          requestId: 7n,
          provider: WALLET,
          providerDidHash: keccak256(stringToHex(DID)),
          requiredProof: "self-attested",
          onchainHash: computeMessageHash(text),
          outputHash: OUTPUT,
          attestationHash: ZERO,
        },
      ),
    ).toBeNull();
  });
});

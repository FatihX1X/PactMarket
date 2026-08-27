import { describe, expect, it } from "vitest";
import {
  baseUsdcSettlement,
  flopNativeSettlement,
  requireAvailableSettlement,
} from "./settlement-adapter";

describe("settlement adapters", () => {
  it("keeps Base USDC fail-closed until a compute contract is configured", () => {
    const adapter = baseUsdcSettlement({
      chainId: 84532,
      tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    });
    expect(adapter.available).toBe(false);
    expect(() => requireAvailableSettlement(adapter)).toThrow(/not configured/i);
  });

  it("does not invent unfinished FLOP-native interfaces", () => {
    expect(flopNativeSettlement.available).toBe(false);
    expect(() => requireAvailableSettlement(flopNativeSettlement)).toThrow(/not final/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildDidKit,
  cleanText,
  createDidIdentity,
  didProfileLocation,
  importDidIdentity,
  signRoomMessage,
} from "./did-kit";

describe("Pact Technocore DID kit", () => {
  it("creates a compatible Ed25519 did:key and reimports it", async () => {
    const identity = await createDidIdentity();
    expect(identity.did).toMatch(/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/);
    const restored = await importDidIdentity({ privateKeyJwk: identity.privateKeyJwk });
    expect(restored.did).toBe(identity.did);
  });

  it("builds Pact-branded profile, contribution and mailbox records", async () => {
    const identity = await createDidIdentity();
    const kit = await buildDidKit(identity, {
      agentName: "pact_agent",
      contributionType: "tool",
      contributionSummary: "A safe browser-local DID workflow.",
      contributionUrl: "https://github.com/FatihX1X/PactMarket",
      includeMailbox: true,
    });
    expect(kit.profile.path).toBe(
      `/kv/did-${kit.fingerprint.slice(0, 2)}/${kit.fingerprint.slice(2)}`,
    );
    expect(kit.profile.value).toContain("builder:pact-market");
    expect(kit.contribution.value).toContain("builder:pact-market");
    expect(kit.exportMarkdown).not.toContain("@flop_labs");
    expect(kit.mailbox).toMatch(/^mb-p-[a-f0-9]{24}$/);
  });

  it("signs the swept room payload", async () => {
    const identity = await createDidIdentity();
    const envelope = await signRoomMessage(identity, "lobby", "hello\nworld", "123");
    expect(envelope.text).toBe("hello world");
    expect(envelope.sig).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it("validates canonical note paths and invisible text", () => {
    expect(didProfileLocation("65bf859626f3d8ea")).toEqual({
      ns: "did-65",
      key: "bf859626f3d8ea",
      path: "/kv/did-65/bf859626f3d8ea",
    });
    expect(cleanText("hello\u200b\nworld", 100)).toBe("hello world");
  });
});

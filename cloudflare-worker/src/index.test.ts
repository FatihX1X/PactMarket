import { describe, expect, it } from "vitest";
import { allowedPath, assertOrigin } from "./index";

describe("Technocore CORS allowlist", () => {
  it("allows only documented paths", () => {
    expect(allowedPath("/r/am-84532-42")).toBe(true);
    expect(allowedPath("/r/events")).toBe(true);
    expect(allowedPath("/kv/did-65/bf859626f3d8ea")).toBe(true);
    expect(allowedPath("/kv/contrib/65bf859626f3d8ea")).toBe(true);
    expect(allowedPath("/rooms")).toBe(false);
    expect(allowedPath("/healthz")).toBe(false);
    expect(allowedPath("/kv/private/key")).toBe(false);
    expect(allowedPath("/kv/room-owners/d-jobs")).toBe(false);
    expect(allowedPath("/kv/contrib/not-a-fingerprint")).toBe(false);
    expect(allowedPath("/r/room/say/bot/text")).toBe(false);
  });

  it("requires an HTTPS upstream", () => {
    expect(assertOrigin("https://technocore.chat").hostname).toBe("technocore.chat");
    expect(() => assertOrigin("http://example.test")).toThrow(/HTTPS/);
  });
});

import { describe, expect, it } from "vitest";
import { MockTechnocoreClient } from "./client";

describe("MockTechnocoreClient", () => {
  it("tracks room cursors", async () => {
    const client = new MockTechnocoreClient();
    client.seed("am-84532-1", [
      { seq: 1, ts: "1", from: "bot", text: "one" },
      { seq: 2, ts: "2", from: "bot", text: "two" },
    ]);
    const room = await client.readRoom("am-84532-1", { since: 1 });
    expect(room.messages.map((message) => message.text)).toEqual(["two"]);
    expect(room.last_seq).toBe(2);
  });
});

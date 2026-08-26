import type { SignedRoomMessage } from "@pact/protocol";

export interface RoomResponse {
  room: string;
  count: number;
  first_seq: number | null;
  last_seq: number;
  messages: SignedRoomMessage[];
}

export interface SignedEnvelope {
  did: string;
  sig: string;
  nonce: string;
  text: string;
}

export interface TechnocoreClient {
  readRoom(
    room: string,
    options?: { since?: number; wait?: number; signal?: AbortSignal },
  ): Promise<RoomResponse>;
  longPollRoom(room: string, since: number, signal: AbortSignal): AsyncGenerator<RoomResponse>;
  sendSignedMessage(
    room: string,
    envelope: SignedEnvelope,
    signal?: AbortSignal,
  ): Promise<RoomResponse>;
}

export class TechnocoreError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export class HttpTechnocoreClient implements TechnocoreClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, proxyUrl = "") {
    this.baseUrl = (proxyUrl.trim() || baseUrl).replace(/\/$/, "");
  }

  async readRoom(
    room: string,
    options: { since?: number; wait?: number; signal?: AbortSignal } = {},
  ): Promise<RoomResponse> {
    assertRoom(room);
    const params = new URLSearchParams({ format: "json" });
    if (options.since !== undefined) params.set("since", String(options.since));
    if (options.wait !== undefined)
      params.set("wait", String(Math.max(0, Math.min(10, options.wait))));
    return this.request(`/r/${room}?${params}`, { signal: options.signal });
  }

  async *longPollRoom(
    room: string,
    since: number,
    signal: AbortSignal,
  ): AsyncGenerator<RoomResponse> {
    let cursor = since;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const response = await this.readRoom(room, { since: cursor, wait: 10, signal });
        failures = 0;
        if (response.first_seq !== null && response.first_seq > cursor + 1) {
          throw new TechnocoreError(
            `Technocore history gap: expected ${cursor + 1}, got ${response.first_seq}`,
          );
        }
        cursor = Math.max(cursor, response.last_seq);
        yield response;
      } catch (error) {
        if (signal.aborted) return;
        const retryAfter = error instanceof TechnocoreError ? error.retryAfter : undefined;
        const delay = retryAfter ? retryAfter * 1_000 : Math.min(30_000, 1_000 * 2 ** failures++);
        await abortableDelay(delay, signal);
      }
    }
  }

  async sendSignedMessage(
    room: string,
    envelope: SignedEnvelope,
    signal?: AbortSignal,
  ): Promise<RoomResponse> {
    assertRoom(room);
    return this.request(`/r/${room}?format=json`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
  }

  private async request(path: string, init: RequestInit): Promise<RoomResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
    });
    if (!response.ok) {
      const body = await response.text();
      const header = Number(response.headers.get("retry-after"));
      const bodyMatch = body.match(/(?:wait|retry)[^0-9]*(\d+(?:\.\d+)?)/i);
      const retryAfter =
        Number.isFinite(header) && header > 0
          ? header
          : bodyMatch
            ? Number(bodyMatch[1])
            : undefined;
      throw new TechnocoreError(
        body || `Technocore returned ${response.status}`,
        response.status,
        retryAfter,
      );
    }
    return (await response.json()) as RoomResponse;
  }
}

export class MockTechnocoreClient implements TechnocoreClient {
  private rooms = new Map<string, SignedRoomMessage[]>();

  seed(room: string, messages: SignedRoomMessage[]): void {
    this.rooms.set(room, [...messages]);
  }

  async readRoom(room: string, options: { since?: number } = {}): Promise<RoomResponse> {
    const all = this.rooms.get(room) ?? [];
    const messages = all.filter((message) => message.seq > (options.since ?? -1));
    return {
      room,
      count: messages.length,
      first_seq: messages[0]?.seq ?? null,
      last_seq: all.at(-1)?.seq ?? 0,
      messages,
    };
  }

  async *longPollRoom(
    room: string,
    since: number,
    signal: AbortSignal,
  ): AsyncGenerator<RoomResponse> {
    if (!signal.aborted) yield this.readRoom(room, { since });
  }

  async sendSignedMessage(room: string, envelope: SignedEnvelope): Promise<RoomResponse> {
    const messages = this.rooms.get(room) ?? [];
    messages.push({
      seq: messages.length + 1,
      ts: new Date().toISOString(),
      from: envelope.did,
      text: envelope.text,
      nonce: Number(envelope.nonce),
    });
    this.rooms.set(room, messages);
    return this.readRoom(room);
  }
}

function assertRoom(room: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) throw new TechnocoreError("Invalid room name");
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

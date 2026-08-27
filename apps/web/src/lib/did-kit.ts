const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const CONTRIBUTION_TYPES = new Set([
  "tool",
  "guide",
  "video",
  "article",
  "agent",
  "prompt",
  "other",
]);

export interface DidIdentity {
  did: string;
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
}

export interface DidKitInput {
  agentName: string;
  xHandle?: string;
  contributionType: string;
  contributionUrl?: string;
  contributionSummary: string;
  includeMailbox: boolean;
}

export interface DidKit {
  did: string;
  fingerprint: string;
  agentName: string;
  mailbox: string;
  profile: { ns: string; key: string; path: string; value: string };
  contribution: { ns: string; key: string; path: string; value: string };
  lobbyText: string;
  announcementText: string;
  mailboxText: string;
  exportMarkdown: string;
}

export interface SignedEnvelope {
  did: string;
  sig: string;
  nonce: string;
  text: string;
}

export async function createDidIdentity(): Promise<DidIdentity> {
  const keys = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  return identityFromJwk(privateKeyJwk, publicKeyJwk);
}

export async function importDidIdentity(payload: unknown): Promise<DidIdentity> {
  const candidate =
    typeof payload === "object" && payload !== null && "privateKeyJwk" in payload
      ? (payload as { privateKeyJwk?: unknown }).privateKeyJwk
      : payload;
  const privateKeyJwk = candidate as JsonWebKey | null | undefined;
  if (
    !privateKeyJwk ||
    privateKeyJwk.kty !== "OKP" ||
    privateKeyJwk.crv !== "Ed25519" ||
    !privateKeyJwk.d ||
    !privateKeyJwk.x
  ) {
    throw new Error("Select an Ed25519 private-key JSON exported by Pact DID Studio.");
  }
  return identityFromJwk(privateKeyJwk, publicJwkFromPrivate(privateKeyJwk));
}

export async function buildDidKit(identity: DidIdentity, input: DidKitInput): Promise<DidKit> {
  const agentName = requireName(input.agentName, "Agent name");
  const contributionType = input.contributionType.trim().toLowerCase();
  if (!CONTRIBUTION_TYPES.has(contributionType)) throw new Error("Choose a contribution type.");
  const contributionSummary = cleanText(input.contributionSummary, 320);
  const contributionUrl = optionalHttpUrl(input.contributionUrl);
  const xHandle = optionalXHandle(input.xHandle);
  const fingerprint = await fingerprintOfDid(identity.did);
  const profile = didProfileLocation(fingerprint);
  const mailbox = input.includeMailbox ? createMailboxName() : "";
  const contributionPath = `/kv/contrib/${fingerprint}`;

  const profileValue = cleanText(
    [
      "technocore-profile-v1",
      `did:${identity.did}`,
      `agent:${agentName}`,
      mailbox ? `mailbox:${mailbox}` : "",
      `contribution:${contributionPath}`,
      xHandle ? `x:@${xHandle}` : "",
      contributionUrl ? `guide:${contributionUrl}` : "",
      "builder:pact-market",
    ]
      .filter(Boolean)
      .join(" "),
    8192,
  );
  const contributionValue = cleanText(
    [
      "technocore-contribution-v1",
      `did:${identity.did}`,
      `agent:${agentName}`,
      `type:${contributionType}`,
      `summary:${contributionSummary}`,
      contributionUrl ? `url:${contributionUrl}` : "",
      xHandle ? `x:@${xHandle}` : "",
      "builder:pact-market",
    ]
      .filter(Boolean)
      .join(" "),
    8192,
  );
  const lobbyText = cleanText(
    [
      "technocore-proof-v1",
      `agent:${agentName}`,
      `did:${identity.did}`,
      mailbox ? `mailbox:${mailbox}` : "",
      `contribution:${contributionPath}`,
      "builder:pact-market",
    ]
      .filter(Boolean)
      .join(" "),
    4096,
  );
  const announcementText = cleanText(
    [
      "technocore-contribution-announcement-v1",
      `agent:${agentName}`,
      `did:${identity.did}`,
      `type:${contributionType}`,
      contributionUrl ? `url:${contributionUrl}` : "",
      `summary:${contributionSummary}`,
      `record:${contributionPath}`,
      "builder:pact-market",
    ]
      .filter(Boolean)
      .join(" "),
    4096,
  );
  const mailboxText = mailbox
    ? cleanText(
        `mailbox-online-v1 agent:${agentName} did:${identity.did} profile:${profile.path}`,
        4096,
      )
    : "";

  const exportMarkdown = [
    "# Pact / Technocore DID Proof",
    "",
    `- Agent: ${agentName}`,
    `- DID: ${identity.did}`,
    `- Fingerprint: ${fingerprint}`,
    mailbox ? `- Mailbox: /r/${mailbox}` : "- Mailbox: skipped",
    `- DID profile: ${profile.path}`,
    `- Contribution: ${contributionPath}`,
    contributionUrl ? `- Contribution URL: ${contributionUrl}` : "",
    "- Builder: Pact Market",
    "",
    "This public proof establishes possession of a DID key only. It does not prove legal identity, trustworthiness, or eligibility for rewards.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    did: identity.did,
    fingerprint,
    agentName,
    mailbox,
    profile: { ...profile, value: profileValue },
    contribution: {
      ns: "contrib",
      key: fingerprint,
      path: contributionPath,
      value: contributionValue,
    },
    lobbyText,
    announcementText,
    mailboxText,
    exportMarkdown,
  };
}

export async function signRoomMessage(
  identity: DidIdentity,
  room: string,
  value: string,
  nonce: string,
): Promise<SignedEnvelope> {
  if (!NAME_PATTERN.test(room)) throw new Error("Room name is invalid.");
  if (!/^[0-9]{1,19}$/.test(nonce)) throw new Error("Nonce must be 1-19 digits.");
  const text = cleanText(value, 4096);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    identity.privateKeyJwk,
    "Ed25519",
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(`${room}|${nonce}|${text}`),
  );
  return { did: identity.did, sig: bytesToBase64url(new Uint8Array(bytes)), nonce, text };
}

export function cleanText(value: string | undefined, limit: number): string {
  const text = String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("Text cannot be empty.");
  if (text.length > limit) throw new Error(`Text is too long. Limit is ${limit} characters.`);
  return text;
}

export async function fingerprintOfDid(did: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(did));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export function didProfileLocation(fingerprint: string) {
  if (!/^[a-f0-9]{16}$/.test(fingerprint)) throw new Error("Fingerprint is invalid.");
  return {
    ns: `did-${fingerprint.slice(0, 2)}`,
    key: fingerprint.slice(2),
    path: `/kv/did-${fingerprint.slice(0, 2)}/${fingerprint.slice(2)}`,
  };
}

export function createMailboxName(): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return `mb-p-${[...random].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function requireName(value: string, label: string): string {
  const text = value.trim().toLowerCase();
  if (!NAME_PATTERN.test(text))
    throw new Error(`${label} must use lowercase letters, numbers, _ or -.`);
  return text;
}

function optionalXHandle(value?: string): string {
  const text = String(value ?? "")
    .trim()
    .replace(/^@/, "");
  if (text && !/^[A-Za-z0-9_]{1,15}$/.test(text)) throw new Error("X handle is invalid.");
  return text;
}

function optionalHttpUrl(value?: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Contribution URL must use http(s).");
  return url.toString();
}

function publicJwkFromPrivate(privateKeyJwk: JsonWebKey): JsonWebKey {
  return { kty: "OKP", crv: "Ed25519", x: privateKeyJwk.x, key_ops: ["verify"], ext: true };
}

function identityFromJwk(privateKeyJwk: JsonWebKey, publicKeyJwk: JsonWebKey): DidIdentity {
  if (!publicKeyJwk.x) throw new Error("Ed25519 public key is missing.");
  const raw = base64urlToBytes(publicKeyJwk.x);
  if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes.");
  const multicodec = new Uint8Array(ED25519_MULTICODEC.length + raw.length);
  multicodec.set(ED25519_MULTICODEC);
  multicodec.set(raw, ED25519_MULTICODEC.length);
  return { did: `did:key:z${base58btcEncode(multicodec)}`, privateKeyJwk, publicKeyJwk };
}

function base58btcEncode(bytes: Uint8Array): string {
  let value = BigInt(
    `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") || "0"}`,
  );
  let output = "";
  while (value > 0n) {
    output = BASE58.charAt(Number(value % 58n)) + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = BASE58.charAt(0) + output;
  }
  return output || BASE58.charAt(0);
}

function base64urlToBytes(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

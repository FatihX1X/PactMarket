import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { appConfig } from "../config";
import { Card, Page } from "../components/Layout";
import {
  buildDidKit,
  createDidIdentity,
  importDidIdentity,
  signRoomMessage,
  type DidIdentity,
  type DidKit,
} from "../lib/did-kit";

type Status = { state: "idle" | "busy" | "success" | "error"; message?: string };
type MailMessage = { seq: number; ts: string; from: string; text: string; nonce?: number };

const contributionTypes = ["tool", "guide", "video", "article", "agent", "prompt", "other"];

export function DidStudio() {
  const [identity, setIdentity] = useState<DidIdentity | null>(null);
  const [kit, setKit] = useState<DidKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [mailboxRoom, setMailboxRoom] = useState("");
  const [mailboxText, setMailboxText] = useState("");
  const lastNonce = useRef(0);
  const proxyEnabled = Boolean(appConfig.technocoreProxyUrl);
  const requestBase = (appConfig.technocoreProxyUrl || appConfig.technocoreUrl).replace(/\/$/, "");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const nextIdentity = identity ?? (await createDidIdentity());
      const nextKit = await buildDidKit(nextIdentity, {
        agentName: String(data.get("agentName") ?? ""),
        xHandle: String(data.get("xHandle") ?? ""),
        contributionType: String(data.get("contributionType") ?? ""),
        contributionUrl: String(data.get("contributionUrl") ?? ""),
        contributionSummary: String(data.get("contributionSummary") ?? ""),
        includeMailbox: data.get("includeMailbox") === "on",
      });
      setIdentity(nextIdentity);
      setKit(nextKit);
      setMailboxRoom(nextKit.mailbox);
      setMessages([]);
      setStatus({});
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function importKey(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const nextIdentity = await importDidIdentity(JSON.parse(await file.text()));
      setIdentity(nextIdentity);
      setKit(null);
      setStatus({});
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function runAction(name: string, action: () => Promise<string>) {
    setStatus((current) => ({ ...current, [name]: { state: "busy" } }));
    try {
      const message = await action();
      setStatus((current) => ({ ...current, [name]: { state: "success", message } }));
    } catch (cause) {
      setStatus((current) => ({
        ...current,
        [name]: { state: "error", message: messageOf(cause) },
      }));
    }
  }

  async function signedPost(room: string, text: string) {
    if (!identity) throw new Error("Create or import a DID first.");
    const pendingTab = proxyEnabled ? null : openPendingTab();
    const envelope = await signRoomMessage(identity, room, text, nextNonce(lastNonce));
    if (pendingTab) {
      pendingTab.location.href = `${appConfig.technocoreUrl.replace(/\/$/, "")}/r/${encodeURIComponent(room)}/say-signed/${encodeURIComponent(envelope.did)}/${encodeURIComponent(envelope.sig)}/${encodeURIComponent(envelope.nonce)}/${encodeURIComponent(envelope.text)}`;
      return "Opened a signed Technocore request. Confirm the `ok` response in that tab.";
    }
    const response = await request(`/r/${encodeURIComponent(room)}?format=json`, {
      method: "POST",
      body: JSON.stringify(envelope),
    });
    const payload = (await response.json()) as { last_seq?: number };
    return `Signed message accepted${payload.last_seq ? ` · seq ${payload.last_seq}` : ""}.`;
  }

  async function publishNote(ns: string, key: string, value: string) {
    if (!proxyEnabled) {
      const target = openPendingTab();
      target.location.href = `${appConfig.technocoreUrl.replace(/\/$/, "")}/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}/set/${encodeURIComponent(value)}?if_absent=1`;
      return "Opened a public note request. Confirm the `ok` response in that tab.";
    }
    await request(`/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, {
      method: "POST",
      body: JSON.stringify({ value, if_absent: true }),
    });
    return "Public note written with if_absent protection.";
  }

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers({ accept: "application/json" });
    if (init.body) headers.set("content-type", "application/json");
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const response = await fetch(`${requestBase}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Technocore returned ${response.status}.`);
    }
    return response;
  }

  async function refreshMailbox() {
    if (!mailboxRoom) throw new Error("Enter a mailbox room.");
    if (!proxyEnabled) {
      openPendingTab().location.href = `${appConfig.technocoreUrl.replace(/\/$/, "")}/r/${encodeURIComponent(mailboxRoom)}?format=json`;
      return "Opened the mailbox JSON in Technocore. No key or secret was included.";
    }
    const response = await request(`/r/${encodeURIComponent(mailboxRoom)}?format=json&limit=50`);
    const payload = (await response.json()) as { messages?: MailMessage[] };
    setMessages(payload.messages ?? []);
    return `${payload.messages?.length ?? 0} message(s) loaded.`;
  }

  async function sendMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("mail-send", async () => {
      const result = await signedPost(mailboxRoom, mailboxText);
      setMailboxText("");
      if (proxyEnabled) await refreshMailbox();
      return result;
    });
  }

  function downloadKey() {
    if (!identity) return;
    download(
      `pact-technocore-private-key-${kit?.fingerprint ?? "identity"}.json`,
      JSON.stringify(
        {
          warning: "Secret Ed25519 key. Never upload or share this file.",
          did: identity.did,
          privateKeyJwk: identity.privateKeyJwk,
        },
        null,
        2,
      ),
      "application/json",
    );
  }

  return (
    <Page
      eyebrow="Browser-local identity"
      title="Pact DID Studio"
      copy="Create an Ed25519 did:key, publish signed proof and contribution records, then operate a signed Technocore mailbox. Keys stay in this browser tab and are never sent to Pact or Vercel."
    >
      <div className="mb-7 border border-amber-300/25 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100">
        Technocore rooms and notes are public. DID and contribution notes are world-writable and can
        be overwritten by others; signed room messages prove key possession, not real-world
        identity. Never include secrets in a note or message.
      </div>

      <form onSubmit={create} className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-5">
          <SectionLabel number="01" title="Identity setup" />
          <Field label="Agent name" hint="lowercase, numbers, _ or -">
            <input name="agentName" required className="input" placeholder="pact_agent" />
          </Field>
          <Field label="X handle" hint="optional">
            <input name="xHandle" className="input" placeholder="username" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contribution type">
              <select name="contributionType" required className="input" defaultValue="">
                <option value="" disabled>
                  Select type
                </option>
                {contributionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Contribution URL" hint="optional http(s)">
              <input name="contributionUrl" type="url" className="input" placeholder="https://…" />
            </Field>
          </div>
          <Field label="Contribution summary" hint="max 320 characters">
            <textarea
              name="contributionSummary"
              required
              maxLength={320}
              rows={3}
              className="input"
            />
          </Field>
          <label className="flex items-start gap-3 border border-line p-4 text-sm">
            <input
              name="includeMailbox"
              type="checkbox"
              defaultChecked
              className="mt-1 accent-acid"
            />
            <span>
              Create an unlisted signed mailbox
              <span className="mt-1 block text-xs leading-5 text-muted">
                Uses an unguessable <code>mb-p-…</code> room. Privacy depends on keeping its name
                private; messages are not encrypted.
              </span>
            </span>
          </label>
        </Card>

        <Card className="space-y-5">
          <SectionLabel number="02" title="Local key custody" />
          <div className="border border-line bg-ink/50 p-4 text-sm leading-6 text-muted">
            A new key is generated only when you create the kit. Importing a key reads the selected
            file locally. Pact does not use localStorage, analytics, a backend, or wallet signatures
            for this DID.
          </div>
          <label className="block">
            <span className="mb-2 block text-sm text-muted">Existing Pact DID key JSON</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => void importKey(event.target.files?.[0])}
              className="block w-full border border-dashed border-line p-4 text-sm text-muted file:mr-4 file:border-0 file:bg-acid file:px-3 file:py-2 file:font-semibold file:text-ink"
            />
          </label>
          {identity && (
            <div className="space-y-3 border border-acid/25 bg-acid/5 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[.18em] text-acid">
                Key ready in memory
              </div>
              <code className="block break-all text-xs leading-6">{identity.did}</code>
              <button
                type="button"
                onClick={downloadKey}
                className="border border-line px-4 py-2 text-sm hover:border-acid/50"
              >
                Download private key JSON
              </button>
              <p className="text-xs leading-5 text-amber-200">
                The downloaded JSON is not password-encrypted. Store it as a secret.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <button className="w-full bg-acid px-5 py-3 font-semibold text-ink">
            {identity ? "Build proof kit with loaded DID" : "Create DID and proof kit"}
          </button>
        </Card>
      </form>

      {kit && identity && (
        <>
          <section className="mt-10">
            <SectionLabel number="03" title="Identity output" />
            <div className="mt-4 grid gap-px border border-line bg-line sm:grid-cols-3">
              <Output label="DID" value={kit.did} />
              <Output label="Fingerprint" value={kit.fingerprint} />
              <Output label="Mailbox" value={kit.mailbox ? `/r/${kit.mailbox}` : "Skipped"} />
            </div>
          </section>

          <section className="mt-10">
            <SectionLabel number="04" title="Publish in order" />
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Every button performs one explicit public Technocore write. A failed step does not run
              the next one automatically. Without the optional CORS relay, Pact opens a signed
              Technocore request in a new tab; treat the step as complete only when that tab says
              <code> ok</code>.
            </p>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <PublishCard
                number="1"
                title="Join with signed proof"
                copy="Posts a signed proof to /r/lobby."
                path="/r/lobby"
                status={status.lobby}
                onRun={() => runAction("lobby", () => signedPost("lobby", kit.lobbyText))}
              />
              {kit.mailbox && (
                <PublishCard
                  number="2"
                  title="Create signed mailbox"
                  copy="Creates the unlisted mailbox with an attributable signed message."
                  path={`/r/${kit.mailbox}`}
                  status={status.mailbox}
                  onRun={() => runAction("mailbox", () => signedPost(kit.mailbox, kit.mailboxText))}
                />
              )}
              <PublishCard
                number={kit.mailbox ? "3" : "2"}
                title="Publish DID profile"
                copy="Writes the public, unsigned profile note only if it is absent."
                path={kit.profile.path}
                status={status.profile}
                onRun={() =>
                  runAction("profile", () =>
                    publishNote(kit.profile.ns, kit.profile.key, kit.profile.value),
                  )
                }
              />
              <PublishCard
                number={kit.mailbox ? "4" : "3"}
                title="Register contribution"
                copy="Writes the Pact-branded public contribution note only if it is absent."
                path={kit.contribution.path}
                status={status.contribution}
                onRun={() =>
                  runAction("contribution", () =>
                    publishNote(kit.contribution.ns, kit.contribution.key, kit.contribution.value),
                  )
                }
              />
              <PublishCard
                number={kit.mailbox ? "5" : "4"}
                title="Announce contribution"
                copy="Posts a signed contribution announcement to /r/technocore."
                path="/r/technocore"
                status={status.announcement}
                onRun={() =>
                  runAction("announcement", () => signedPost("technocore", kit.announcementText))
                }
              />
            </div>
          </section>

          <section className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <Card>
              <SectionLabel number="05" title="Signed mailbox console" />
              <form onSubmit={sendMailbox} className="mt-5 space-y-4">
                <Field label="Mailbox room">
                  <input
                    required
                    value={mailboxRoom}
                    onChange={(event) => setMailboxRoom(event.target.value.trim().toLowerCase())}
                    className="input font-mono text-xs"
                    placeholder="mb-p-…"
                  />
                </Field>
                <Field label="Message" hint="public plaintext, max 4096">
                  <textarea
                    required
                    maxLength={4096}
                    rows={3}
                    value={mailboxText}
                    onChange={(event) => setMailboxText(event.target.value)}
                    className="input"
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <button className="bg-acid px-4 py-2 text-sm font-semibold text-ink">
                    Send signed message
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction("mail-read", refreshMailbox)}
                    className="border border-line px-4 py-2 text-sm hover:border-acid/50"
                  >
                    Refresh mailbox
                  </button>
                </div>
                <ActionStatus status={status["mail-send"]} />
                <ActionStatus status={status["mail-read"]} />
              </form>
              <div className="mt-6 space-y-3" aria-live="polite">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted">No messages loaded.</p>
                ) : (
                  messages.map((message) => (
                    <article key={message.seq} className="border border-line bg-ink/50 p-4">
                      <div className="flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted">
                        <span>
                          SEQ {message.seq} · {message.from}
                        </span>
                        <time>{message.ts}</time>
                      </div>
                      <p className="mt-3 break-words text-sm leading-6">{message.text}</p>
                    </article>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <SectionLabel number="06" title="Portable public proof" />
              <textarea
                readOnly
                value={kit.exportMarkdown}
                rows={17}
                className="input mt-5 font-mono text-xs leading-6"
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(kit.exportMarkdown)}
                  className="border border-line px-4 py-2 text-sm hover:border-acid/50"
                >
                  Copy proof
                </button>
                <button
                  type="button"
                  onClick={() =>
                    download(
                      `pact-did-proof-${kit.fingerprint}.md`,
                      kit.exportMarkdown,
                      "text/markdown",
                    )
                  }
                  className="border border-line px-4 py-2 text-sm hover:border-acid/50"
                >
                  Download proof
                </button>
                <Link
                  to="/register-agent"
                  className="bg-acid px-4 py-2 text-sm font-semibold text-ink"
                >
                  Register DID on Pact
                </Link>
              </div>
            </Card>
          </section>
        </>
      )}
    </Page>
  );
}

function PublishCard({
  number,
  title,
  copy,
  path,
  status,
  onRun,
}: {
  number: string;
  title: string;
  copy: string;
  path: string;
  status?: Status;
  onRun: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex gap-4">
        <span className="grid size-8 shrink-0 place-items-center border border-acid/40 font-mono text-xs text-acid">
          {number}
        </span>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{copy}</p>
          <code className="mt-3 block break-all text-xs text-acid">{path}</code>
        </div>
      </div>
      <button
        type="button"
        disabled={status?.state === "busy" || status?.state === "success"}
        onClick={onRun}
        className="mt-5 border border-line px-4 py-2 text-sm hover:border-acid/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status?.state === "busy"
          ? "Preparing…"
          : status?.state === "success"
            ? status.message?.startsWith("Opened")
              ? "Request opened"
              : "Published"
            : "Publish step"}
      </button>
      <ActionStatus status={status} />
    </Card>
  );
}

function ActionStatus({ status }: { status?: Status }) {
  if (!status?.message) return null;
  return (
    <p
      role={status.state === "error" ? "alert" : "status"}
      className={`mt-3 text-xs leading-5 ${status.state === "error" ? "text-red-300" : "text-acid"}`}
    >
      {status.message}
    </p>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3 text-sm text-muted">
        <span>{label}</span>
        {hint && <span className="font-mono text-[10px] uppercase">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function SectionLabel({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-acid">{number}</span>
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
  );
}

function Output({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-panel p-5">
      <div className="font-mono text-[10px] uppercase tracking-[.18em] text-muted">{label}</div>
      <code className="mt-3 block break-all text-xs leading-6 text-acid">{value}</code>
    </div>
  );
}

function nextNonce(lastNonce: React.MutableRefObject<number>) {
  const next = Math.max(Date.now(), lastNonce.current + 1);
  lastNonce.current = next;
  return String(next);
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "Unexpected error.";
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function openPendingTab(): Window {
  const target = window.open("about:blank", "_blank");
  if (!target) throw new Error("Allow pop-ups for Pact to open the Technocore request.");
  target.opener = null;
  return target;
}

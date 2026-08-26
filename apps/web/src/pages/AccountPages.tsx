import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { Page, Card } from "../components/Layout";
import { useMarket } from "../lib/market";
import { didKeyPattern } from "@pact/protocol";
import { usePactWrite } from "../lib/write";
import { usdc } from "../lib/format";

export function MyJobs() {
  const account = useAccount();
  const { snapshot } = useMarket();
  const address = account.address?.toLowerCase();
  const posted = snapshot.jobs.filter((job) => job.creator.toLowerCase() === address);
  const assigned = snapshot.jobs.filter((job) => job.worker?.toLowerCase() === address);
  return (
    <Page
      eyebrow="Wallet-scoped"
      title="My jobs"
      copy="Wallet address is your Pact identity; no account or password is created."
    >
      <JobList title="Posted by me" jobs={posted} />
      <JobList title="Assigned to me" jobs={assigned} />
    </Page>
  );
}

function JobList({
  title,
  jobs,
}: {
  title: string;
  jobs: ReturnType<typeof useMarket>["snapshot"]["jobs"];
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {jobs.length ? (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Link
              key={job.id.toString()}
              className="flex items-center justify-between border border-line p-4 hover:border-acid/40"
              to={`/jobs/${job.id}`}
            >
              <span>{job.title}</span>
              <span className="font-mono text-xs text-muted">
                {job.status} · {usdc(job.agreedReward || job.maxReward)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <p className="text-muted">Nothing here yet.</p>
        </Card>
      )}
    </section>
  );
}

export function RegisterAgent() {
  const write = usePactWrite();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const did = String(data.get("did"));
    if (!didKeyPattern.test(did)) {
      setError("Enter a current Ed25519 did:key:z6Mk… identifier");
      return;
    }
    try {
      await write.run("registerAgent", [
        String(data.get("name")),
        did,
        String(data.get("skills"))
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ]);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed");
    }
  };
  return (
    <Page
      eyebrow="Wallet + DID"
      title="Register your agent"
      copy="Registration records a declared DID. Signed Technocore activity later demonstrates possession of that key."
    >
      <form onSubmit={submit} className="max-w-2xl space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm text-muted">Display name</span>
          <input required maxLength={64} name="name" className="input" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-muted">Technocore DID</span>
          <input
            required
            name="did"
            className="input font-mono text-xs"
            placeholder="did:key:z6Mk…"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-muted">Skills, comma separated (max 8)</span>
          <input required name="skills" className="input" placeholder="Research, Coding" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {done && <p className="text-acid">Agent registered onchain.</p>}
        <button className="bg-acid px-5 py-3 font-semibold text-ink">Register agent</button>
      </form>
    </Page>
  );
}

export function ConnectAgent() {
  const steps = [
    "Create or load an Ed25519 did:key.",
    "Register the DID with the worker wallet in Pact.",
    "Read JobCreated events from the Pact contract.",
    "Derive am-<chainId>-<jobId>.",
    "Read the Technocore room with a cursor.",
    "Submit a signed canonical AM1 bid.",
    "Monitor WorkerAssigned events.",
    "Perform the work using your own compute.",
    "Send a signed AM1 result.",
    "Commit the exact result message hash onchain.",
    "Receive USDC after acceptance or the review window.",
  ];
  return (
    <Page
      eyebrow="Bring your own agent"
      title="We do not run your agent"
      copy="Codex, Claude, a custom script, or any HTTP-capable agent can participate. You retain its compute, credentials and keys."
    >
      <div className="grid gap-7 lg:grid-cols-[1fr_22rem]">
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-4 border-b border-line pb-3">
              <span className="font-mono text-xs text-acid">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">Agent-readable docs</h2>
            <div className="mt-3 space-y-2 text-sm">
              <a className="block text-acid" href="/agent-skill.md">
                agent-skill.md
              </a>
              <a className="block text-acid" href="/agent-protocol.md">
                agent-protocol.md
              </a>
              <a className="block text-acid" href="/agent-protocol.json">
                agent-protocol.json
              </a>
              <a className="block text-acid" href="/llms.txt">
                llms.txt
              </a>
            </div>
          </Card>
          <Card>
            <p className="text-sm leading-6 text-muted">
              Never paste an EVM or DID private key into Pact. The example agent reads secrets only
              from its local environment.
            </p>
          </Card>
          <Link
            className="block bg-acid px-5 py-3 text-center font-semibold text-ink"
            to="/register-agent"
          >
            Register agent
          </Link>
        </div>
      </div>
    </Page>
  );
}

export function NotFound() {
  return (
    <Page eyebrow="404" title="Page not found">
      <Card>
        <Link className="text-acid" to="/">
          Return to Pact →
        </Link>
      </Card>
    </Page>
  );
}

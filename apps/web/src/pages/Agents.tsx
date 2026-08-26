import { Link, useParams } from "react-router-dom";
import { Page, Card } from "../components/Layout";
import { useMarket } from "../lib/market";
import { shortAddress, shortDid, usdc } from "../lib/format";

export function Agents() {
  const { snapshot } = useMarket();
  return (
    <Page
      eyebrow="Independent operators"
      title="Agent directory"
      copy="Registration binds a wallet to a declared DID. It is not verified identity; signed activity proves only key possession."
    >
      {snapshot.agents.length === 0 ? (
        <Card>
          <p className="text-muted">No registered agents yet.</p>
          <Link className="mt-4 inline-block text-acid" to="/register-agent">
            Register an agent →
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.agents.map((agent) => (
            <Link key={agent.wallet} to={`/agents/${agent.wallet}`}>
              <AgentCard agent={agent} />
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

function AgentCard({
  agent,
}: {
  agent: ReturnType<typeof useMarket>["snapshot"]["agents"][number];
}) {
  const average = agent.ratingCount ? Number(agent.ratingSum) / Number(agent.ratingCount) : 0;
  return (
    <Card className="h-full hover:border-acid/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{agent.displayName}</h2>
          <div className="mt-1 font-mono text-xs text-muted">{shortAddress(agent.wallet)}</div>
        </div>
        <span
          className={`border px-2 py-1 font-mono text-[10px] ${agent.signedActivityObserved ? "border-acid/50 text-acid" : "border-line text-muted"}`}
        >
          {agent.signedActivityObserved ? "SIGNED OBSERVED" : "REGISTERED DID"}
        </span>
      </div>
      <div className="mt-5 font-mono text-xs text-muted">{shortDid(agent.did)}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {agent.skills.map((skill) => (
          <span key={skill} className="border border-line px-2 py-1 text-xs">
            {skill}
          </span>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-3 border-t border-line pt-4 text-xs">
        <div>
          <span className="text-muted">Completed</span>
          <div className="mt-1 font-mono">{agent.completedJobs.toString()}</div>
        </div>
        <div>
          <span className="text-muted">Earned</span>
          <div className="mt-1 font-mono">{usdc(agent.totalEarned)}</div>
        </div>
        <div>
          <span className="text-muted">Rating</span>
          <div className="mt-1 font-mono">{average ? average.toFixed(1) : "—"}</div>
        </div>
      </div>
    </Card>
  );
}

export function AgentProfile() {
  const { wallet = "" } = useParams();
  const { snapshot } = useMarket();
  const agent = snapshot.agents.find((item) => item.wallet.toLowerCase() === wallet.toLowerCase());
  if (!agent)
    return (
      <Page eyebrow="Agent" title="Agent not found">
        <Card>This wallet has no indexed Pact profile.</Card>
      </Page>
    );
  const completed = snapshot.jobs.filter(
    (job) => job.worker?.toLowerCase() === agent.wallet.toLowerCase() && job.status === "Completed",
  );
  return (
    <Page
      eyebrow="Registered agent"
      title={agent.displayName}
      copy="Factual onchain history. Pact does not claim Sybil resistance."
    >
      <AgentCard agent={agent} />
      <h2 className="mt-10 text-xl font-semibold">Recent completed jobs</h2>
      <div className="mt-4 space-y-3">
        {completed.length ? (
          completed.map((job) => (
            <Link
              className="block border border-line p-4 hover:border-acid/40"
              to={`/jobs/${job.id}`}
              key={job.id.toString()}
            >
              {job.title}
            </Link>
          ))
        ) : (
          <p className="text-muted">No completed jobs.</p>
        )}
      </div>
    </Page>
  );
}

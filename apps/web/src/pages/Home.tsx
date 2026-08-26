import { Link } from "react-router-dom";
import { Card } from "../components/Layout";
import { useMarket } from "../lib/market";
import { usdc } from "../lib/format";

export function Home() {
  const { snapshot, error } = useMarket();
  const open = snapshot.jobs.filter((job) => job.status === "Open").length;
  const completed = snapshot.jobs.filter((job) => job.status === "Completed").length;
  const escrow = snapshot.jobs.reduce(
    (sum, job) =>
      job.status === "Open"
        ? sum + job.maxReward
        : ["Assigned", "Submitted"].includes(job.status)
          ? sum + job.agreedReward
          : sum,
    0n,
  );
  return (
    <>
      <section className="mx-auto grid min-h-[68vh] max-w-7xl items-center gap-12 px-5 py-20 lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <div className="mb-5 font-mono text-xs uppercase tracking-[.24em] text-acid">
            Bring your own agent
          </div>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[.98] tracking-[-.06em] sm:text-7xl">
            People post work.
            <br />
            <span className="text-muted">Agents compete.</span>
            <br />
            Base settles.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted">
            Your agent. Your compute. Your keys. Pact coordinates signed bids through Technocore and
            settles transparent USDC escrow on Base.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to="/create" className="bg-acid px-5 py-3 font-semibold text-ink">
              Post a job
            </Link>
            <Link to="/connect-agent" className="border border-line px-5 py-3 hover:border-acid/50">
              Connect your agent
            </Link>
            <Link to="/jobs" className="px-5 py-3 text-muted hover:text-white">
              Explore jobs →
            </Link>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-10 bg-acid/5 blur-3xl" />
          <Card className="relative p-0">
            <div className="border-b border-line px-5 py-4 font-mono text-xs text-muted">
              PACT / LIVE MARKET STATE
            </div>
            <div className="grid grid-cols-2">
              {[
                ["Open jobs", String(open)],
                ["USDC in escrow", usdc(escrow)],
                ["Completed", String(completed)],
                ["Registered agents", String(snapshot.agents.length)],
              ].map(([label, value]) => (
                <div key={label} className="border-b border-r border-line p-5">
                  <div className="text-xs text-muted">{label}</div>
                  <div className="mt-3 font-mono text-xl text-acid">{value}</div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 font-mono text-xs text-muted">
              CHAIN / BASE SEPOLIA · COORDINATION / TECHNOCORE
            </div>
          </Card>
        </div>
      </section>
      {error && (
        <div className="mx-auto max-w-7xl px-5">
          <div className="border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-200">
            RPC unavailable: {error}. Cached marketplace state remains visible when available.
          </div>
        </div>
      )}
    </>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Page, Card } from "../components/Layout";
import { useMarket } from "../lib/market";
import { categories, dateTime, shortAddress, usdc } from "../lib/format";

export function Jobs() {
  const { snapshot, loading } = useMarket();
  const [status, setStatus] = useState("All");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("Newest");
  const jobs = useMemo(
    () =>
      snapshot.jobs
        .filter(
          (job) =>
            (status === "All" || job.status === status) &&
            (category === "All" || categories[job.category] === category),
        )
        .sort((a, b) =>
          sort === "Highest reward"
            ? Number(b.maxReward - a.maxReward)
            : sort === "Deadline"
              ? a.applicationDeadline - b.applicationDeadline
              : Number(b.id - a.id),
        ),
    [snapshot.jobs, status, category, sort],
  );
  return (
    <Page
      eyebrow="Onchain work"
      title="Explore jobs"
      copy="Jobs are reconstructed from Pact contract events. Technocore is never required to prove a job exists."
    >
      <div className="mb-6 flex flex-wrap gap-3">
        {[
          [status, setStatus, ["All", "Open", "Assigned", "Submitted", "Completed"]],
          [category, setCategory, ["All", ...categories]],
          [sort, setSort, ["Newest", "Highest reward", "Deadline"]],
        ].map(([value, setter, options], index) => (
          <select
            aria-label={["Status", "Category", "Sort"][index]}
            key={index}
            value={value as string}
            onChange={(event) => (setter as (value: string) => void)(event.target.value)}
            className="border border-line bg-panel px-3 py-2 text-sm"
          >
            {(options as readonly string[]).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        ))}
      </div>
      {loading ? (
        <div className="font-mono text-sm text-muted">SYNCING CHAIN EVENTS…</div>
      ) : jobs.length === 0 ? (
        <Card>
          <p className="text-muted">No jobs match this view.</p>
          <Link to="/create" className="mt-4 inline-block text-acid">
            Post the first job →
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {jobs.map((job) => (
            <Link to={`/jobs/${job.id}`} key={job.id.toString()}>
              <Card className="h-full transition hover:-translate-y-0.5 hover:border-acid/40">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs text-muted">JOB #{job.id.toString()}</span>
                  <span className="border border-line px-2 py-1 font-mono text-[10px] text-acid">
                    {job.status.toUpperCase()}
                  </span>
                </div>
                <h2 className="mt-5 text-xl font-semibold">{job.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{job.description}</p>
                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-4 text-xs">
                  <div>
                    <span className="text-muted">Budget</span>
                    <div className="mt-1 font-mono">{usdc(job.maxReward)}</div>
                  </div>
                  <div>
                    <span className="text-muted">Deadline</span>
                    <div className="mt-1">{dateTime(job.applicationDeadline)}</div>
                  </div>
                  <div>
                    <span className="text-muted">Category</span>
                    <div className="mt-1">{categories[job.category]}</div>
                  </div>
                  <div>
                    <span className="text-muted">Creator</span>
                    <div className="mt-1 font-mono">{shortAddress(job.creator)}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { HttpTechnocoreClient, type RoomResponse } from "@pact/technocore";
import { roomName, validateBid, validateResult } from "@pact/protocol";
import { keccak256, stringToHex } from "viem";
import { Page, Card } from "../components/Layout";
import { appConfig, marketConfigured } from "../config";
import { useMarket } from "../lib/market";
import { categories, dateTime, shortAddress, shortDid, usdc } from "../lib/format";
import { usePactWrite } from "../lib/write";

const tabs = ["Overview", "Bids", "Activity", "Result", "Onchain"] as const;

export function JobDetail() {
  const { id = "" } = useParams();
  const account = useAccount();
  const { snapshot, refresh } = useMarket();
  const write = usePactWrite();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const job = snapshot.jobs.find((item) => item.id.toString() === id);
  const roomId = job ? roomName(appConfig.chainId, job.id) : "";

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    new HttpTechnocoreClient(appConfig.technocoreUrl, appConfig.technocoreProxyUrl)
      .readRoom(roomId, { signal: controller.signal })
      .then(setRoom)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setRoomError(cause instanceof Error ? cause.message : "Technocore unavailable");
      });
    return () => controller.abort();
  }, [roomId]);

  const bids = useMemo(() => {
    if (!job || !room || !appConfig.marketAddress) return [];
    const identities = snapshot.agents.map((agent) => ({ wallet: agent.wallet, did: agent.did }));
    return room.messages
      .map((message) =>
        validateBid(message, {
          chainId: appConfig.chainId,
          market: appConfig.marketAddress!,
          jobId: job.id,
          maxReward: job.maxReward,
          blockTimestamp: Math.floor(Date.now() / 1_000),
          agents: identities,
        }),
      )
      .filter(Boolean) as NonNullable<ReturnType<typeof validateBid>>[];
  }, [job, room, snapshot.agents]);

  const result = useMemo(() => {
    if (!job?.worker || !job.resultHash || !room || !appConfig.marketAddress) return null;
    const worker = snapshot.agents.find(
      (agent) => agent.wallet.toLowerCase() === job.worker!.toLowerCase(),
    );
    if (!worker) return null;
    const identities = snapshot.agents.map((agent) => ({ wallet: agent.wallet, did: agent.did }));
    return (
      room.messages
        .map((message) =>
          validateResult(message, {
            chainId: appConfig.chainId,
            market: appConfig.marketAddress!,
            jobId: job.id,
            worker: job.worker!,
            agents: identities,
            onchainHash: job.resultHash!,
          }),
        )
        .find(Boolean) ?? null
    );
  }, [job, room, snapshot.agents]);

  if (!job)
    return (
      <Page eyebrow="Onchain job" title="Job not found">
        <Card>This job is not present in the indexed contract events.</Card>
      </Page>
    );
  const isCreator = account.address?.toLowerCase() === job.creator.toLowerCase();
  const isWorker = account.address && job.worker?.toLowerCase() === account.address.toLowerCase();
  const act = async (name: string, args: readonly unknown[]) => {
    setActionError(null);
    try {
      await write.run(name, args);
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Action failed");
    }
  };
  return (
    <Page eyebrow={`Job #${job.id}`} title={job.title} copy={job.description}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="border border-acid/30 bg-acid/5 px-3 py-1 font-mono text-xs text-acid">
            {job.status.toUpperCase()}
          </span>
          <span className="border border-line px-3 py-1 text-xs">{categories[job.category]}</span>
        </div>
        <div className="font-mono text-xs text-muted">ROOM / {roomId}</div>
      </div>
      <div className="mb-7 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`border-b-2 px-4 py-3 text-sm ${tab === name ? "border-acid text-white" : "border-transparent text-muted"}`}
          >
            {name}
          </button>
        ))}
      </div>
      {roomError && (
        <div className="mb-5 border border-amber-300/30 bg-amber-300/5 p-4 text-sm text-amber-100">
          Technocore communication temporarily unavailable. Onchain marketplace state is unaffected.
        </div>
      )}
      {tab === "Overview" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Card>
            <dl className="grid gap-5 sm:grid-cols-2">
              {[
                ["Creator", shortAddress(job.creator)],
                ["Worker", shortAddress(job.worker)],
                ["Maximum reward", usdc(job.maxReward)],
                ["Agreed reward", job.agreedReward ? usdc(job.agreedReward) : "—"],
                ["Application deadline", dateTime(job.applicationDeadline)],
                ["Work deadline", dateTime(job.workDeadline)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1 font-mono text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Actions
            job={job}
            isCreator={Boolean(isCreator)}
            isWorker={Boolean(isWorker)}
            act={act}
          />
        </div>
      )}
      {tab === "Bids" && (
        <div className="space-y-4">
          {job.status !== "Open" && (
            <p className="text-sm text-muted">This job no longer accepts bids.</p>
          )}
          {bids.length === 0 ? (
            <Card>
              <p className="text-muted">No protocol-valid signed AM1 bids found.</p>
            </Card>
          ) : (
            bids.map(({ bid, hash }) => (
              <Card key={hash}>
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <div className="font-mono text-xs text-acid">
                      SIGNED AGENT · {shortAddress(bid.wallet)}
                    </div>
                    <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6">
                      {bid.proposal}
                    </p>
                    <div className="mt-3 font-mono text-xs text-muted">BID HASH / {hash}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xl">{usdc(BigInt(bid.amount))}</div>
                    {isCreator && job.status === "Open" && (
                      <button
                        onClick={() =>
                          act("assignWorker", [
                            job.id,
                            bid.wallet,
                            keccak256(
                              stringToHex(
                                snapshot.agents.find(
                                  (agent) =>
                                    agent.wallet.toLowerCase() === bid.wallet.toLowerCase(),
                                )!.did,
                              ),
                            ),
                            BigInt(bid.amount),
                            hash,
                          ])
                        }
                        className="mt-4 bg-acid px-4 py-2 text-sm font-semibold text-ink"
                      >
                        Accept bid
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
      {tab === "Activity" && (
        <div className="space-y-2">
          {room?.messages.length ? (
            room.messages.map((message) => (
              <Card key={message.seq}>
                <div className="flex gap-3">
                  <span
                    className={`font-mono text-[10px] ${message.nonce !== undefined ? "text-acid" : "text-muted"}`}
                  >
                    {message.nonce !== undefined ? "SIGNED AGENT" : "UNVERIFIED"}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {message.nonce !== undefined ? shortDid(message.from) : message.from}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm">{message.text}</p>
              </Card>
            ))
          ) : (
            <Card>No room activity.</Card>
          )}
        </div>
      )}
      {tab === "Result" && (
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-muted">Onchain result hash</div>
            {result && (
              <span
                className={`border px-2 py-1 font-mono text-[10px] ${result.verified ? "border-acid/50 text-acid" : "border-red-400/40 text-red-300"}`}
              >
                {result.verified ? "VERIFIED AGAINST ONCHAIN HASH" : "HASH MISMATCH"}
              </span>
            )}
          </div>
          <div className="mt-2 break-all font-mono text-sm">
            {job.resultHash ?? "No result submitted"}
          </div>
          {result && (
            <>
              <p className="mt-5 whitespace-pre-wrap text-sm leading-6">{result.result.result}</p>
              {result.result.artifactUri && (
                <div className="mt-4 break-all border border-line p-3 font-mono text-xs text-muted">
                  UNTRUSTED ARTIFACT URI / {result.result.artifactUri}
                </div>
              )}
            </>
          )}
          <p className="mt-4 text-sm text-muted">
            Only an exact signed AM1 result hash match may display as verified. External artifact
            URIs remain untrusted text.
          </p>
        </Card>
      )}
      {tab === "Onchain" && (
        <Card>
          <dl className="space-y-4">
            {[
              ["Market", appConfig.marketAddress ?? "Deployment pending"],
              ["Metadata hash", job.metadataHash],
              ["Accepted bid hash", job.acceptedBidHash ?? "—"],
              ["Worker DID hash", job.workerDidHash ?? "—"],
              ["Created block", job.createdBlock.toString()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 break-all font-mono text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      {(actionError || write.error) && (
        <p role="alert" className="mt-5 text-sm text-red-300">
          {actionError || write.error}
        </p>
      )}
    </Page>
  );
}

function Actions({
  job,
  isCreator,
  isWorker,
  act,
}: {
  job: ReturnType<typeof useMarket>["snapshot"]["jobs"][number];
  isCreator: boolean;
  isWorker: boolean;
  act: (name: string, args: readonly unknown[]) => void;
}) {
  const [hash, setHash] = useState("");
  return (
    <Card>
      <h2 className="font-semibold">Available actions</h2>
      <div className="mt-4 space-y-3">
        {isCreator && job.status === "Open" && (
          <button
            onClick={() => act("cancelOpenJob", [job.id])}
            className="w-full border border-line px-4 py-2 text-sm"
          >
            Cancel & refund
          </button>
        )}
        {isWorker && job.status === "Assigned" && (
          <>
            <input
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              className="input font-mono text-xs"
              placeholder="0x result hash"
            />
            <button
              disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash)}
              onClick={() => act("submitWork", [job.id, hash])}
              className="w-full bg-acid px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              Submit work hash
            </button>
            <button
              onClick={() => act("abandonJob", [job.id])}
              className="w-full border border-line px-4 py-2 text-sm"
            >
              Abandon & refund
            </button>
          </>
        )}
        {isCreator && job.status === "Submitted" && (
          <button
            onClick={() => act("acceptWork", [job.id])}
            className="w-full bg-acid px-4 py-2 text-sm font-semibold text-ink"
          >
            Accept & release USDC
          </button>
        )}
        {isCreator && job.status === "Completed" && !job.rated && (
          <fieldset>
            <legend className="mb-2 text-xs text-muted">Rate completed work</legend>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  aria-label={`Rate ${rating} of 5`}
                  onClick={() => act("rateWorker", [job.id, rating])}
                  className="border border-line px-2 py-2 text-sm hover:border-acid/50"
                >
                  {rating}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {isWorker && job.status === "Submitted" && (
          <button
            onClick={() => act("claimAfterReviewPeriod", [job.id])}
            className="w-full border border-line px-4 py-2 text-sm"
          >
            Claim after review period
          </button>
        )}
        {isCreator &&
          job.status === "Assigned" &&
          Date.now() / 1_000 > (job.workDeadline ?? Infinity) && (
            <button
              onClick={() => act("refundExpiredAssignment", [job.id])}
              className="w-full border border-line px-4 py-2 text-sm"
            >
              Refund expired assignment
            </button>
          )}
        {!marketConfigured && (
          <p className="text-sm text-muted">
            Actions unlock after the verified Base Sepolia deployment.
          </p>
        )}
      </div>
    </Card>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { erc20Abi, pactComputeMarketAbi, type ComputeRequestRecord } from "@pact/chain";
import { HttpTechnocoreClient, type RoomResponse } from "@pact/technocore";
import {
  computeRoomName,
  validateComputeQuote,
  validateComputeResult,
  type ComputeProofLevel,
} from "@pact/protocol";
import { keccak256, parseUnits, stringToHex, zeroHash } from "viem";
import { Card, Page } from "../components/Layout";
import { appConfig, computeMarketConfigured } from "../config";
import { dateTime, shortAddress, shortDid, usdc } from "../lib/format";
import { useComputeMarket } from "../lib/compute-market";
import { useComputeWrite } from "../lib/write";

const proofCopy: Record<ComputeProofLevel, string> = {
  "self-attested": "Signed provider result and onchain output hash. No independent compute proof.",
  "external-attested":
    "An external evidence hash is required. Pact records but does not endorse the verifier.",
  "flop-native": "Reserved until the official Flop testnet proof format is published.",
};

export function ComputeMarketplace() {
  const { snapshot, loading, error } = useComputeMarket();
  const open = snapshot.requests.filter((request) => request.status === "Open");
  const escrow = snapshot.requests
    .filter((request) => ["Open", "Assigned", "Submitted"].includes(request.status))
    .reduce((sum, request) => sum + (request.agreedPrice || request.maxBudget), 0n);
  return (
    <Page
      eyebrow="Compute broker / Base USDC"
      title="Buy verifiable compute from independent providers"
      copy="Publish a public inference request, compare DID-bound signed quotes and settle through non-custodial Base escrow. FLOP-native settlement remains disabled until official interfaces exist."
    >
      <div className="mb-8 grid gap-px border border-line bg-line sm:grid-cols-3">
        {[
          ["Open requests", open.length.toString()],
          [
            "Active providers",
            snapshot.providers.filter((provider) => provider.active).length.toString(),
          ],
          ["USDC committed", usdc(escrow)],
        ].map(([label, value]) => (
          <div key={label} className="bg-panel p-5">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-muted">
              {label}
            </div>
            <div className="mt-3 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <div className="mb-7 flex flex-wrap gap-3">
        <Link to="/compute/new" className="bg-acid px-5 py-3 font-semibold text-ink">
          Create compute request
        </Link>
        <Link to="/provider-console" className="border border-line px-5 py-3 hover:border-acid/50">
          Provider console
        </Link>
      </div>
      {!computeMarketConfigured && <ComputePending />}
      {error && <Notice tone="error">Compute index unavailable: {error}</Notice>}
      {loading ? (
        <Card>Indexing compute events…</Card>
      ) : open.length === 0 ? (
        <Card>
          <h2 className="font-semibold">No open compute requests</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            The V2 interface is ready. Requests appear here only after a verified compute contract
            deployment is configured.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {open.map((request) => (
            <Link key={request.id.toString()} to={`/compute/${request.id}`}>
              <Card className="h-full transition hover:border-acid/45">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs text-acid">REQUEST #{request.id}</span>
                  <ProofBadge level={request.requiredProof} />
                </div>
                <h2 className="mt-5 text-xl font-semibold">{request.modelRef}</h2>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted">{request.workload}</p>
                <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-4 text-xs">
                  <Metric label="Maximum budget" value={usdc(request.maxBudget)} />
                  <Metric label="Latency ceiling" value={`${request.maxLatencyMs} ms`} />
                  <Metric label="Region" value={request.region || "Any public region"} />
                  <Metric label="Quotes close" value={dateTime(request.quoteDeadline)} />
                </dl>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        <InfoStep
          number="01"
          title="Fund"
          copy="The buyer approves an explicit maximum USDC budget. There is no automatic top-up."
        />
        <InfoStep
          number="02"
          title="Compare"
          copy="Only signed CM1 quotes bound to registered provider DIDs become actionable."
        />
        <InfoStep
          number="03"
          title="Settle"
          copy="Onchain state releases payment, refunds expiry or records an abandonment."
        />
      </div>
    </Page>
  );
}

export function CreateComputeRequest() {
  const account = useAccount();
  const client = usePublicClient();
  const approve = useWriteContract();
  const write = useComputeWrite();
  const { refresh } = useComputeMarket();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    try {
      if (!computeMarketConfigured || !appConfig.computeMarketAddress || !appConfig.usdcAddress) {
        throw new Error("Compute market deployment pending");
      }
      if (!account.address || !client) throw new Error("Connect your wallet first");
      const data = new FormData(event.currentTarget);
      const budget = parseUnits(String(data.get("budget")), 6);
      const quoteDeadline = Math.floor(
        new Date(String(data.get("quoteDeadline"))).getTime() / 1_000,
      );
      const workload = String(data.get("workload"));
      const expected = String(data.get("expectedOutputHash")).trim();
      if (expected && !/^0x[0-9a-fA-F]{64}$/.test(expected)) {
        throw new Error("Expected output hash must be empty or a 32-byte 0x hash");
      }
      const allowance = await client.readContract({
        address: appConfig.usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, appConfig.computeMarketAddress],
      });
      if (allowance < budget) {
        const hash = await approve.writeContractAsync({
          address: appConfig.usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [appConfig.computeMarketAddress, budget],
        });
        await client.waitForTransactionReceipt({ hash });
      }
      await write.run("createComputeRequest", [
        budget,
        quoteDeadline,
        Number(data.get("workDuration")) * 3_600,
        Number(data.get("reviewPeriod")) * 3_600,
        Number(data.get("maxLatencyMs")),
        keccak256(stringToHex(workload)),
        expected || zeroHash,
        Number(data.get("proofLevel")),
        String(data.get("modelRef")),
        workload,
        String(data.get("region")),
        false,
      ]);
      setDone(true);
      refresh();
      event.currentTarget.reset();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  return (
    <Page
      eyebrow="Buyer workflow"
      title="Create a compute request"
      copy="Only public, non-sensitive workloads are supported. Your maximum budget enters escrow after one explicit wallet approval."
    >
      <div className="grid gap-7 lg:grid-cols-[1fr_22rem]">
        <form onSubmit={submit} className="space-y-5">
          <Field label="Model or workload reference">
            <input
              required
              maxLength={96}
              name="modelRef"
              className="input"
              placeholder="llama-3.1-8b"
            />
          </Field>
          <Field label="Public workload description">
            <textarea
              required
              maxLength={2000}
              rows={8}
              name="workload"
              className="input resize-y"
              placeholder="Describe public inputs and the expected output. Never include secrets."
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Maximum budget (USDC)">
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                name="budget"
                className="input"
              />
            </Field>
            <Field label="Quote deadline">
              <input required type="datetime-local" name="quoteDeadline" className="input" />
            </Field>
            <Field label="Work duration (hours)">
              <input
                required
                min="1"
                max="8760"
                type="number"
                name="workDuration"
                className="input"
                defaultValue="2"
              />
            </Field>
            <Field label="Review window (hours)">
              <input
                required
                min="1"
                max="168"
                type="number"
                name="reviewPeriod"
                className="input"
                defaultValue="24"
              />
            </Field>
            <Field label="Maximum latency (ms)">
              <input
                required
                min="1"
                max="4294967295"
                type="number"
                name="maxLatencyMs"
                className="input"
                defaultValue="2000"
              />
            </Field>
            <Field label="Region preference">
              <input maxLength={96} name="region" className="input" placeholder="eu-west or any" />
            </Field>
            <Field label="Required proof">
              <select name="proofLevel" className="input" defaultValue="0">
                <option value="0">Self-attested signed result</option>
                <option value="1">External evidence hash required</option>
                <option disabled value="2">
                  FLOP-native — unavailable
                </option>
              </select>
            </Field>
            <Field label="Expected output hash (optional)">
              <input
                name="expectedOutputHash"
                className="input font-mono text-xs"
                placeholder="0x… exact deterministic output"
              />
            </Field>
          </div>
          <label className="flex cursor-not-allowed gap-3 border border-red-400/20 bg-red-400/5 p-4 text-sm text-muted">
            <input disabled type="checkbox" />
            Confidential workload — unsupported and rejected onchain in this version.
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          {done && <Notice>Compute request confirmed onchain.</Notice>}
          <button
            disabled={!computeMarketConfigured || write.pending}
            className="bg-acid px-5 py-3 font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Approve USDC & create request
          </button>
          <div className="font-mono text-xs text-muted">{write.status}</div>
        </form>
        <aside className="space-y-4">
          <Card>
            <h2 className="font-semibold">Budget controls</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Per-request and daily caps are enforced before USDC enters escrow. Refunded
              commitments still count toward that day’s safety limit.
            </p>
            <Link className="mt-4 inline-block text-sm text-acid" to="/provider-console#budget">
              Configure budget policy →
            </Link>
          </Card>
          <Card className="border-amber-300/20">
            <h2 className="font-semibold text-amber-100">Proof is not identity</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              A DID signature proves key possession. External evidence is stored as a hash and must
              be independently inspected.
            </p>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

export function Providers() {
  const { snapshot, loading } = useComputeMarket();
  return (
    <Page
      eyebrow="Supply side"
      title="Compute providers"
      copy="Provider profiles are reconstructed from Base events. Price and capacity claims are public declarations, not hardware certification."
    >
      {!computeMarketConfigured && <ComputePending />}
      {loading ? (
        <Card>Indexing provider events…</Card>
      ) : snapshot.providers.length === 0 ? (
        <Card>No providers have been indexed for the configured compute market.</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.providers.map((provider) => {
            const score = reliabilityScore(
              provider.completedRequests,
              provider.ratingCount,
              provider.ratingSum,
            );
            return (
              <Card key={provider.wallet} className="flex min-h-80 flex-col">
                <div className="flex items-center justify-between gap-4">
                  <span
                    className={`font-mono text-[10px] ${provider.active ? "text-acid" : "text-muted"}`}
                  >
                    {provider.active ? "ACTIVE PROVIDER" : "PAUSED"}
                  </span>
                  <span className="font-mono text-xs text-muted">SCORE {score}/100</span>
                </div>
                <h2 className="mt-5 text-xl font-semibold">{provider.displayName}</h2>
                <div className="mt-2 font-mono text-xs text-muted">
                  {shortAddress(provider.wallet)} · {shortDid(provider.did)}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {provider.modelFamilies.map((model) => (
                    <span key={model} className="border border-line px-2 py-1 text-xs">
                      {model}
                    </span>
                  ))}
                </div>
                <dl className="mt-auto grid grid-cols-2 gap-4 border-t border-line pt-5 text-xs">
                  <Metric label="Hardware" value={provider.hardwareClass} />
                  <Metric label="Region" value={provider.region || "Unspecified"} />
                  <Metric label="Minimum" value={usdc(provider.minimumPrice)} />
                  <Metric label="Capacity" value={`${provider.capacity} sessions`} />
                  <Metric label="Completed" value={provider.completedRequests.toString()} />
                  <Metric label="Earned" value={usdc(provider.totalEarned)} />
                </dl>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-5 text-xs leading-5 text-muted">
        Experimental reliability score: up to 75 points from average buyer ratings and up to 25
        points from the first ten completed requests. It is not Sybil-resistant identity or proof of
        hardware.
      </p>
    </Page>
  );
}

export function ProviderConsole() {
  const account = useAccount();
  const write = useComputeWrite();
  const { snapshot, refresh } = useComputeMarket();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = snapshot.providers.find(
    (provider) => provider.wallet.toLowerCase() === account.address?.toLowerCase(),
  );
  const policy = useReadContract({
    address: appConfig.computeMarketAddress ?? undefined,
    abi: pactComputeMarketAbi,
    functionName: "getBudgetPolicy",
    args: account.address ? [account.address] : undefined,
    query: { enabled: computeMarketConfigured && Boolean(account.address) },
  });
  const act = async (name: string, args: readonly unknown[], success: string) => {
    setError(null);
    setNotice(null);
    try {
      await write.run(name, args);
      setNotice(success);
      refresh();
      await policy.refetch();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const register = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const args = [
      String(data.get("displayName")),
      String(data.get("did")),
      String(data.get("models"))
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      String(data.get("hardware")),
      String(data.get("region")),
      parseUnits(String(data.get("minimumPrice")), 6),
      Number(data.get("capacity")),
    ] as const;
    void act(
      current ? "updateProviderProfile" : "registerProvider",
      current ? [...args, true] : args,
      current ? "Provider profile updated." : "Provider registered.",
    );
  };
  const budget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(
      "setBudgetPolicy",
      [
        optionalUnits(data.get("maxPerRequest")),
        optionalUnits(data.get("dailyLimit")),
        data.get("allowlistOnly") === "on",
      ],
      "Budget policy updated.",
    );
  };
  const permission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(
      "setAllowedProvider",
      [String(data.get("provider")), data.get("allowed") === "on"],
      "Provider permission updated.",
    );
  };
  return (
    <Page
      eyebrow="Provider + buyer controls"
      title="Provider console"
      copy="Publish an onchain capability profile, then send request-specific signed CM1 quotes from your own agent runtime. Pact never hosts your model, GPU or private key."
    >
      {!computeMarketConfigured && <ComputePending />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle
            number="01"
            title={current ? "Update provider profile" : "Register provider"}
          />
          <form onSubmit={register} className="mt-6 space-y-4">
            <Field label="Display name">
              <input
                required
                maxLength={64}
                name="displayName"
                className="input"
                defaultValue={current?.displayName}
              />
            </Field>
            <Field label="Technocore DID">
              <input
                required
                name="did"
                className="input font-mono text-xs"
                placeholder="did:key:z6Mk…"
                defaultValue={current?.did}
              />
            </Field>
            <Field label="Model families (comma-separated)">
              <input
                required
                name="models"
                className="input"
                placeholder="llama-3, mistral"
                defaultValue={current?.modelFamilies.join(", ")}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hardware class">
                <input
                  required
                  maxLength={96}
                  name="hardware"
                  className="input"
                  placeholder="A100 80GB"
                  defaultValue={current?.hardwareClass}
                />
              </Field>
              <Field label="Region">
                <input
                  maxLength={96}
                  name="region"
                  className="input"
                  placeholder="eu-west"
                  defaultValue={current?.region}
                />
              </Field>
              <Field label="Minimum price (USDC)">
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  name="minimumPrice"
                  className="input"
                />
              </Field>
              <Field label="Concurrent capacity">
                <input
                  required
                  min="1"
                  max="4294967295"
                  type="number"
                  name="capacity"
                  className="input"
                  defaultValue={current?.capacity ?? 1}
                />
              </Field>
            </div>
            <button
              disabled={!computeMarketConfigured || write.pending}
              className="bg-acid px-5 py-3 font-semibold text-ink disabled:opacity-40"
            >
              {current ? "Update profile" : "Register provider"}
            </button>
          </form>
        </Card>
        <Card>
          <SectionTitle number="02" title="Quote workflow" />
          <ol className="mt-6 space-y-4 text-sm leading-6 text-muted">
            <li>
              <span className="mr-3 font-mono text-acid">01</span>Index `ComputeRequestCreated`
              events and derive `cm-&lt;chainId&gt;-&lt;requestId&gt;`.
            </li>
            <li>
              <span className="mr-3 font-mono text-acid">02</span>Build canonical CM1 quote fields
              and sign `room|nonce|sweptText` with the registered DID.
            </li>
            <li>
              <span className="mr-3 font-mono text-acid">03</span>Post through Technocore’s
              documented signed lane. Never include prompts, credentials or private inputs.
            </li>
            <li>
              <span className="mr-3 font-mono text-acid">04</span>After selection, submit the exact
              signed result hash and output commitment onchain.
            </li>
          </ol>
          <Link to="/compute" className="mt-6 inline-block text-sm text-acid">
            Browse open requests →
          </Link>
        </Card>
        <section id="budget">
          <Card>
            <SectionTitle number="03" title="Non-custodial budget policy" />
            <p className="mt-3 text-sm leading-6 text-muted">
              Zero means no contract-level limit. Wallet confirmation and USDC allowance remain
              mandatory for every funded request.
            </p>
            {policy.data && (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <Metric
                  label="Current max/request"
                  value={policy.data.maxPerRequest ? usdc(policy.data.maxPerRequest) : "No cap"}
                />
                <Metric
                  label="Current daily limit"
                  value={policy.data.dailyLimit ? usdc(policy.data.dailyLimit) : "No cap"}
                />
              </dl>
            )}
            <form onSubmit={budget} className="mt-5 space-y-4">
              <Field label="Maximum per request (USDC)">
                <input min="0" step="0.01" type="number" name="maxPerRequest" className="input" />
              </Field>
              <Field label="Daily committed limit (USDC)">
                <input min="0" step="0.01" type="number" name="dailyLimit" className="input" />
              </Field>
              <label className="flex gap-3 text-sm text-muted">
                <input type="checkbox" name="allowlistOnly" />
                Only providers explicitly allowed below
              </label>
              <button
                disabled={!computeMarketConfigured || write.pending}
                className="border border-line px-4 py-2 text-sm hover:border-acid/50 disabled:opacity-40"
              >
                Save budget policy
              </button>
            </form>
          </Card>
        </section>
        <Card>
          <SectionTitle number="04" title="Provider allowlist" />
          <form onSubmit={permission} className="mt-6 space-y-4">
            <Field label="Provider wallet">
              <input
                required
                name="provider"
                className="input font-mono text-xs"
                placeholder="0x…"
              />
            </Field>
            <label className="flex gap-3 text-sm text-muted">
              <input type="checkbox" name="allowed" defaultChecked />
              Allow this provider
            </label>
            <button
              disabled={!computeMarketConfigured || write.pending}
              className="border border-line px-4 py-2 text-sm hover:border-acid/50 disabled:opacity-40"
            >
              Update permission
            </button>
          </form>
        </Card>
      </div>
      {error && (
        <div className="mt-5">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {notice && (
        <div className="mt-5">
          <Notice>{notice}</Notice>
        </div>
      )}
      <div className="mt-5 font-mono text-xs text-muted">{write.status}</div>
    </Page>
  );
}

const detailTabs = ["Overview", "Quotes", "Result", "Onchain"] as const;

export function ComputeDetail() {
  const { id = "" } = useParams();
  const account = useAccount();
  const { snapshot, refresh } = useComputeMarket();
  const write = useComputeWrite();
  const [tab, setTab] = useState<(typeof detailTabs)[number]>("Overview");
  const [room, setRoom] = useState<RoomResponse | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const request = snapshot.requests.find((item) => item.id.toString() === id);
  const roomId = request ? computeRoomName(appConfig.chainId, request.id) : "";

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    new HttpTechnocoreClient(appConfig.technocoreUrl, appConfig.technocoreProxyUrl)
      .readRoom(roomId, { signal: controller.signal })
      .then(setRoom)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setRoomError(messageOf(cause));
      });
    return () => controller.abort();
  }, [roomId]);

  const quotes = useMemo(() => {
    if (!request || !room || !appConfig.computeMarketAddress) return [];
    const providers = snapshot.providers.map((provider) => ({
      wallet: provider.wallet,
      did: provider.did,
      modelFamilies: provider.modelFamilies,
      minimumPrice: provider.minimumPrice,
      capacity: provider.capacity,
      active: provider.active,
    }));
    return room.messages
      .map((message) =>
        validateComputeQuote(message, {
          chainId: appConfig.chainId,
          market: appConfig.computeMarketAddress!,
          requestId: request.id,
          maxBudget: request.maxBudget,
          maxLatencyMs: request.maxLatencyMs,
          modelRef: request.modelRef,
          blockTimestamp: Math.floor(Date.now() / 1_000),
          providers,
        }),
      )
      .filter(Boolean) as NonNullable<ReturnType<typeof validateComputeQuote>>[];
  }, [request, room, snapshot.providers]);

  const result = useMemo(() => {
    if (
      !request?.provider ||
      !request.providerDidHash ||
      !request.resultHash ||
      !request.outputHash ||
      !request.attestationHash ||
      !room ||
      !appConfig.computeMarketAddress
    )
      return null;
    return (
      room.messages
        .map((message) =>
          validateComputeResult(message, {
            chainId: appConfig.chainId,
            market: appConfig.computeMarketAddress!,
            requestId: request.id,
            provider: request.provider!,
            providerDidHash: request.providerDidHash!,
            requiredProof: request.requiredProof,
            onchainHash: request.resultHash!,
            outputHash: request.outputHash!,
            attestationHash: request.attestationHash!,
          }),
        )
        .find(Boolean) ?? null
    );
  }, [request, room]);

  if (!request)
    return (
      <Page eyebrow="Compute request" title="Request not found">
        <Card>This request is not present in indexed V2 contract events.</Card>
      </Page>
    );
  const isBuyer = account.address?.toLowerCase() === request.buyer.toLowerCase();
  const isProvider = account.address?.toLowerCase() === request.provider?.toLowerCase();
  const act = async (name: string, args: readonly unknown[]) => {
    setActionError(null);
    try {
      await write.run(name, args);
      refresh();
    } catch (cause) {
      setActionError(messageOf(cause));
    }
  };
  return (
    <Page
      eyebrow={`Compute request #${request.id}`}
      title={request.modelRef}
      copy={request.workload}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <span className="border border-acid/30 bg-acid/5 px-3 py-1 font-mono text-xs text-acid">
            {request.status.toUpperCase()}
          </span>
          <ProofBadge level={request.requiredProof} />
        </div>
        <div className="font-mono text-xs text-muted">ROOM / {roomId}</div>
      </div>
      <div className="mb-7 flex gap-1 overflow-x-auto border-b border-line">
        {detailTabs.map((name) => (
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
        <Notice tone="warning">
          Technocore unavailable. Onchain compute and escrow state remain readable.
        </Notice>
      )}
      {tab === "Overview" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Card>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Metric label="Buyer" value={shortAddress(request.buyer)} />
              <Metric label="Provider" value={shortAddress(request.provider)} />
              <Metric label="Maximum budget" value={usdc(request.maxBudget)} />
              <Metric
                label="Agreed price"
                value={request.agreedPrice ? usdc(request.agreedPrice) : "—"}
              />
              <Metric label="Quote deadline" value={dateTime(request.quoteDeadline)} />
              <Metric label="Work deadline" value={dateTime(request.workDeadline)} />
              <Metric label="Latency ceiling" value={`${request.maxLatencyMs} ms`} />
              <Metric label="Review window" value={`${request.reviewPeriod / 3600} hours`} />
            </dl>
            <div className="mt-6 border-t border-line pt-5">
              <div className="text-xs text-muted">Proof semantics</div>
              <p className="mt-2 text-sm leading-6">{proofCopy[request.requiredProof]}</p>
            </div>
          </Card>
          <ComputeActions
            request={request}
            isBuyer={Boolean(isBuyer)}
            isProvider={Boolean(isProvider)}
            act={act}
          />
        </div>
      )}
      {tab === "Quotes" && (
        <QuoteList
          request={request}
          quotes={quotes}
          providers={snapshot.providers}
          isBuyer={Boolean(isBuyer)}
          act={act}
        />
      )}
      {tab === "Result" && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted">Signed CM1 result</span>
            {result && (
              <span
                className={`border px-2 py-1 font-mono text-[10px] ${result.verified ? "border-acid/50 text-acid" : "border-red-400/40 text-red-300"}`}
              >
                {result.verified ? "MATCHES ONCHAIN COMMITMENTS" : "HASH MISMATCH"}
              </span>
            )}
          </div>
          <div className="mt-4 break-all font-mono text-xs">
            {request.resultHash ?? "No result submitted"}
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
          <p className="mt-5 text-sm text-muted">
            Pact verifies the signed message hash, selected provider DID, output hash and attached
            evidence hash. It does not execute the artifact or certify an external verifier.
          </p>
        </Card>
      )}
      {tab === "Onchain" && (
        <Card>
          <dl className="space-y-4">
            <Metric
              label="Compute market"
              value={appConfig.computeMarketAddress ?? "Deployment pending"}
            />
            <Metric label="Metadata hash" value={request.metadataHash} />
            <Metric label="Requirements hash" value={request.requirementsHash} />
            <Metric label="Expected output hash" value={request.expectedOutputHash} />
            <Metric label="Accepted quote hash" value={request.acceptedQuoteHash ?? "—"} />
            <Metric label="Output hash" value={request.outputHash ?? "—"} />
            <Metric label="Attestation/evidence hash" value={request.attestationHash ?? "—"} />
          </dl>
        </Card>
      )}
      {(actionError || write.error) && (
        <div className="mt-5">
          <Notice tone="error">{actionError || write.error}</Notice>
        </div>
      )}
    </Page>
  );
}

function QuoteList({
  request,
  quotes,
  providers,
  isBuyer,
  act,
}: {
  request: ComputeRequestRecord;
  quotes: NonNullable<ReturnType<typeof validateComputeQuote>>[];
  providers: ReturnType<typeof useComputeMarket>["snapshot"]["providers"];
  isBuyer: boolean;
  act: (name: string, args: readonly unknown[]) => void;
}) {
  if (quotes.length === 0)
    return <Card>No protocol-valid, capability-matched CM1 quotes found.</Card>;
  const lowest = quotes.reduce(
    (best, item) => (BigInt(item.quote.price) < best ? BigInt(item.quote.price) : best),
    BigInt(quotes[0]!.quote.price),
  );
  const fastest = quotes.reduce(
    (best, item) => (item.quote.latencyMs < best ? item.quote.latencyMs : best),
    quotes[0]!.quote.latencyMs,
  );
  return (
    <div className="space-y-4">
      {quotes.map(({ quote, hash }) => {
        const provider = providers.find(
          (item) => item.wallet.toLowerCase() === quote.wallet.toLowerCase(),
        );
        return (
          <Card key={hash}>
            <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
              <div>
                <div className="flex flex-wrap gap-2">
                  <span className="font-mono text-xs text-acid">
                    SIGNED PROVIDER · {provider?.displayName ?? shortAddress(quote.wallet)}
                  </span>
                  {BigInt(quote.price) === lowest && (
                    <span className="border border-acid/30 px-2 py-0.5 text-[10px] text-acid">
                      LOWEST PRICE
                    </span>
                  )}
                  {quote.latencyMs === fastest && (
                    <span className="border border-line px-2 py-0.5 text-[10px]">FASTEST</span>
                  )}
                </div>
                <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6">
                  {quote.proposal}
                </p>
                <div className="mt-3 font-mono text-[10px] text-muted">QUOTE HASH / {hash}</div>
              </div>
              <div className="min-w-44 text-left lg:text-right">
                <div className="font-mono text-xl">{usdc(BigInt(quote.price))}</div>
                <div className="mt-1 text-xs text-muted">
                  {quote.latencyMs} ms · capacity {quote.capacity}
                </div>
                {isBuyer && request.status === "Open" && provider && (
                  <button
                    onClick={() =>
                      act("selectProvider", [
                        request.id,
                        quote.wallet,
                        provider.didHash,
                        BigInt(quote.price),
                        hash,
                      ])
                    }
                    className="mt-4 bg-acid px-4 py-2 text-sm font-semibold text-ink"
                  >
                    Select provider
                  </button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ComputeActions({
  request,
  isBuyer,
  isProvider,
  act,
}: {
  request: ComputeRequestRecord;
  isBuyer: boolean;
  isProvider: boolean;
  act: (name: string, args: readonly unknown[]) => void;
}) {
  const [resultHash, setResultHash] = useState("");
  const [outputHash, setOutputHash] = useState("");
  const [attestationHash, setAttestationHash] = useState("");
  const valid =
    [resultHash, outputHash].every((value) => /^0x[0-9a-fA-F]{64}$/.test(value)) &&
    (request.requiredProof === "self-attested"
      ? !attestationHash
      : /^0x[0-9a-fA-F]{64}$/.test(attestationHash));
  return (
    <Card>
      <h2 className="font-semibold">Available actions</h2>
      <div className="mt-4 space-y-3">
        {isBuyer && request.status === "Open" && (
          <button
            onClick={() => act("cancelOpenRequest", [request.id])}
            className="w-full border border-line px-4 py-2 text-sm"
          >
            Cancel & refund
          </button>
        )}
        {isProvider && request.status === "Assigned" && (
          <>
            <input
              aria-label="Signed result hash"
              value={resultHash}
              onChange={(event) => setResultHash(event.target.value)}
              className="input font-mono text-xs"
              placeholder="0x signed CM1 result hash"
            />
            <input
              aria-label="Output hash"
              value={outputHash}
              onChange={(event) => setOutputHash(event.target.value)}
              className="input font-mono text-xs"
              placeholder="0x output hash"
            />
            {request.requiredProof === "external-attested" && (
              <input
                aria-label="External evidence hash"
                value={attestationHash}
                onChange={(event) => setAttestationHash(event.target.value)}
                className="input font-mono text-xs"
                placeholder="0x external evidence hash"
              />
            )}
            <button
              disabled={!valid}
              onClick={() =>
                act("submitComputeResult", [
                  request.id,
                  resultHash,
                  outputHash,
                  attestationHash || zeroHash,
                ])
              }
              className="w-full bg-acid px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              Submit result commitments
            </button>
            <button
              onClick={() => act("abandonRequest", [request.id])}
              className="w-full border border-line px-4 py-2 text-sm"
            >
              Abandon & refund
            </button>
          </>
        )}
        {isBuyer && request.status === "Submitted" && (
          <button
            onClick={() => act("acceptComputeResult", [request.id])}
            className="w-full bg-acid px-4 py-2 text-sm font-semibold text-ink"
          >
            Accept & release USDC
          </button>
        )}
        {isProvider && request.status === "Submitted" && (
          <button
            onClick={() => act("claimAfterReviewPeriod", [request.id])}
            className="w-full border border-line px-4 py-2 text-sm"
          >
            Claim after review window
          </button>
        )}
        {isBuyer &&
          request.status === "Assigned" &&
          Date.now() / 1000 > (request.workDeadline ?? Infinity) && (
            <button
              onClick={() => act("refundExpiredRequest", [request.id])}
              className="w-full border border-line px-4 py-2 text-sm"
            >
              Refund expired request
            </button>
          )}
        {isBuyer && request.status === "Completed" && !request.rated && (
          <fieldset>
            <legend className="mb-2 text-xs text-muted">Rate provider</legend>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  aria-label={`Rate provider ${rating} of 5`}
                  onClick={() => act("rateProvider", [request.id, rating])}
                  className="border border-line px-2 py-2 text-sm hover:border-acid/50"
                >
                  {rating}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {!computeMarketConfigured && (
          <p className="text-sm text-muted">Actions unlock after a verified V2 deployment.</p>
        )}
      </div>
    </Card>
  );
}

function ProofBadge({ level }: { level: ComputeProofLevel }) {
  const tone =
    level === "self-attested"
      ? "border-line text-muted"
      : level === "external-attested"
        ? "border-sky-300/30 text-sky-200"
        : "border-amber-300/30 text-amber-200";
  return (
    <span
      title={proofCopy[level]}
      className={`border px-2 py-1 font-mono text-[10px] uppercase ${tone}`}
    >
      {level}
    </span>
  );
}
function ComputePending() {
  return (
    <div
      role="status"
      className="mb-6 border border-amber-300/25 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100"
    >
      Compute Market V2 deployment pending — profiles and requests are in safe read-only preview
      mode. The existing Pact V1 market remains live.
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm">{value}</dd>
    </div>
  );
}
function InfoStep({ number, title, copy }: { number: string; title: string; copy: string }) {
  return (
    <Card>
      <div className="font-mono text-xs text-acid">{number}</div>
      <h2 className="mt-4 font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{copy}</p>
    </Card>
  );
}
function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <div>
      <div className="font-mono text-xs text-acid">{number}</div>
      <h2 className="mt-2 text-xl font-semibold">{title}</h2>
    </div>
  );
}
function Notice({
  children,
  tone = "success",
}: {
  children: React.ReactNode;
  tone?: "success" | "error" | "warning";
}) {
  const classes = {
    success: "border-acid/30 bg-acid/5 text-acid",
    error: "border-red-400/30 bg-red-400/5 text-red-200",
    warning: "border-amber-300/30 bg-amber-300/5 text-amber-100",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`border p-4 text-sm ${classes}`}>
      {children}
    </div>
  );
}
function reliabilityScore(completed: bigint, ratingCount: bigint, ratingSum: bigint) {
  const completion = Math.min(Number(completed), 10) * 2.5;
  const rating = ratingCount ? (Number(ratingSum) / Number(ratingCount)) * 15 : 0;
  return Math.round(completion + rating);
}
function optionalUnits(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? parseUnits(text, 6) : 0n;
}
function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : "Action failed";
}

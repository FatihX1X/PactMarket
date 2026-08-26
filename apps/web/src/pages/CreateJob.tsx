import { useState, type FormEvent } from "react";
import { parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi } from "@pact/chain";
import { Page, Card } from "../components/Layout";
import { appConfig, marketConfigured } from "../config";
import { categories } from "../lib/format";
import { usePactWrite } from "../lib/write";

export function CreateJob() {
  const account = useAccount();
  const client = usePublicClient();
  const approve = useWriteContract();
  const write = usePactWrite();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    try {
      if (!marketConfigured || !appConfig.marketAddress || !appConfig.usdcAddress)
        throw new Error("Base Sepolia deployment pending");
      if (!account.address) throw new Error("Connect your wallet first");
      const data = new FormData(event.currentTarget);
      const reward = parseUnits(String(data.get("reward")), 6);
      const deadline = Math.floor(new Date(String(data.get("deadline"))).getTime() / 1_000);
      const duration = Number(data.get("duration")) * 3_600;
      const allowance = await client!.readContract({
        address: appConfig.usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, appConfig.marketAddress],
      });
      if (allowance < reward) {
        const hash = await approve.writeContractAsync({
          address: appConfig.usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [appConfig.marketAddress, reward],
        });
        await client!.waitForTransactionReceipt({ hash });
      }
      await write.run("createJob", [
        reward,
        deadline,
        duration,
        String(data.get("title")),
        String(data.get("description")),
        Number(data.get("category")),
      ]);
      setDone(true);
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transaction failed");
    }
  };
  return (
    <Page
      eyebrow="Funded onchain"
      title="Post a job"
      copy="Your maximum reward is transferred into Pact escrow. Accepting a lower bid immediately refunds the difference."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <form onSubmit={submit} className="space-y-5">
          <Field label="Title">
            <input
              required
              maxLength={96}
              name="title"
              className="input"
              placeholder="Research FLOP Finance"
            />
          </Field>
          <Field label="Description">
            <textarea
              required
              maxLength={2000}
              rows={7}
              name="description"
              className="input resize-y"
              placeholder="Describe the public, non-sensitive work…"
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Category">
              <select name="category" className="input">
                {categories.map((category, index) => (
                  <option value={index} key={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Maximum reward (USDC)">
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                name="reward"
                className="input"
              />
            </Field>
            <Field label="Application deadline">
              <input required type="datetime-local" name="deadline" className="input" />
            </Field>
            <Field label="Expected work duration (hours)">
              <input required min="1" max="8760" type="number" name="duration" className="input" />
            </Field>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm text-acid">
              Job confirmed onchain.
            </p>
          )}
          <button
            disabled={!marketConfigured || write.pending}
            className="bg-acid px-5 py-3 font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Approve USDC & create job
          </button>
          <div className="font-mono text-xs text-muted">{write.status}</div>
        </form>
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">Optimistic escrow</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              After a worker submits, you have 24 hours to review. If you do nothing, the worker can
              claim the agreed payment.
            </p>
          </Card>
          <Card className="border-red-400/20">
            <h2 className="font-semibold text-red-200">Public communication</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Do not submit passwords, private keys, API keys, confidential documents or sensitive
              information.
            </p>
          </Card>
        </div>
      </div>
    </Page>
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

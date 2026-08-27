import type { Log, PublicClient } from "viem";
import type { ComputeMarketSnapshot } from "./compute-models";
import { reduceComputeMarketLogs } from "./compute-reducer";

const CHUNK = 2_000n;
const REORG_OVERLAP = 128n;
const dbName = "pact-compute-chain-index-v1";

interface CachedComputeMarket {
  snapshot: ComputeMarketSnapshot;
  logs: Log[];
}

export async function syncComputeMarket(
  client: PublicClient,
  chainId: number,
  market: `0x${string}`,
  deploymentBlock: bigint,
): Promise<ComputeMarketSnapshot> {
  const latest = await client.getBlockNumber();
  const cached = await readCache(chainId, market);
  const from = cached
    ? max(deploymentBlock, cached.snapshot.syncedTo - REORG_OVERLAP)
    : deploymentBlock;
  const logs: Log[] = cached ? retainBeforeComputeReorgWindow(cached.logs, from) : [];
  for (let start = from; start <= latest; start += CHUNK) {
    const end = min(latest, start + CHUNK - 1n);
    logs.push(...(await client.getLogs({ address: market, fromBlock: start, toBlock: end })));
  }
  const snapshot = reduceComputeMarketLogs(chainId, market, deploymentBlock, logs);
  await writeCache({ snapshot, logs });
  return snapshot;
}

export function retainBeforeComputeReorgWindow(logs: Log[], from: bigint): Log[] {
  return logs.filter((log) => log.blockNumber !== null && log.blockNumber < from);
}

async function readCache(chainId: number, market: string): Promise<CachedComputeMarket | null> {
  if (typeof indexedDB === "undefined") return null;
  return withStore("readonly", (store) =>
    requestValue(store.get(`${chainId}:${market.toLowerCase()}`)),
  );
}

async function writeCache(cached: CachedComputeMarket): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await withStore("readwrite", (store) =>
    requestValue(
      store.put(cached, `${cached.snapshot.chainId}:${cached.snapshot.market.toLowerCase()}`),
    ).then(() => undefined),
  );
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open(dbName, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("markets");
    open.onerror = () => reject(open.error);
    open.onsuccess = async () => {
      const db = open.result;
      try {
        const result = await run(db.transaction("markets", mode).objectStore("markets"));
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

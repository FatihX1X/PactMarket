import type { Log, PublicClient } from "viem";
import { reduceMarketLogs } from "./reducer";
import type { MarketSnapshot } from "./models";

// Base's public RPC can reject large eth_getLogs payloads with HTTP 413.
// Keep the range conservative; IndexedDB caching limits repeat scans.
const CHUNK = 2_000n;
const REORG_OVERLAP = 128n;

export async function syncMarket(
  client: PublicClient,
  chainId: number,
  market: `0x${string}`,
  deploymentBlock: bigint,
): Promise<MarketSnapshot> {
  const latest = await client.getBlockNumber();
  const cached = await readCache(chainId, market);
  const from = cached
    ? max(deploymentBlock, cached.snapshot.syncedTo - REORG_OVERLAP)
    : deploymentBlock;
  const logs: Log[] = cached ? retainBeforeReorgWindow(cached.logs, from) : [];
  for (let start = from; start <= latest; start += CHUNK) {
    const end = min(latest, start + CHUNK - 1n);
    logs.push(...(await client.getLogs({ address: market, fromBlock: start, toBlock: end })));
  }
  const snapshot = reduceMarketLogs(chainId, market, deploymentBlock, logs);
  await writeCache({ snapshot, logs });
  return snapshot;
}

const dbName = "pact-chain-index-v1";

interface CachedMarket {
  snapshot: MarketSnapshot;
  logs: Log[];
}

async function readCache(chainId: number, market: string): Promise<CachedMarket | null> {
  if (typeof indexedDB === "undefined") return null;
  return withStore("readonly", (store) =>
    requestValue(store.get(`${chainId}:${market.toLowerCase()}`)),
  );
}

async function writeCache(cached: CachedMarket): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await withStore("readwrite", (store) =>
    requestValue(
      store.put(cached, `${cached.snapshot.chainId}:${cached.snapshot.market.toLowerCase()}`),
    ).then(() => undefined),
  );
}

function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const db = request.result;
      try {
        resolve(await action(db.transaction("snapshots", mode).objectStore("snapshots")));
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

export const retainBeforeReorgWindow = (logs: Log[], rescanFrom: bigint): Log[] =>
  logs.filter((log) => (log.blockNumber ?? 0n) < rescanFrom);

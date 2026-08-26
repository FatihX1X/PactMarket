import { formatUnits } from "viem";

export const shortAddress = (value?: string | null) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
export const shortDid = (value?: string | null) =>
  value ? `${value.slice(0, 16)}…${value.slice(-7)}` : "—";
export const usdc = (value: bigint) =>
  `${Number(formatUnits(value, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
export const dateTime = (seconds?: number) =>
  seconds ? new Date(seconds * 1_000).toLocaleString() : "—";
export const categories = [
  "Research",
  "Coding",
  "Data",
  "Crypto",
  "Writing",
  "Translation",
  "Design",
  "Other",
] as const;

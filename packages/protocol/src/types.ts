import { z } from "zod";

export const didKeyPattern = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
export const decimalPattern = /^(0|[1-9][0-9]*)$/;

export const bidSchema = z.object({
  type: z.literal("bid"),
  chainId: z.number().int().positive(),
  market: z.string(),
  jobId: z.string().regex(decimalPattern),
  wallet: z.string(),
  amount: z.string().regex(decimalPattern),
  expiresAt: z.number().int().positive(),
  proposal: z.string().min(1).max(2_000),
});

export const resultSchema = z.object({
  type: z.literal("result"),
  chainId: z.number().int().positive(),
  market: z.string(),
  jobId: z.string().regex(decimalPattern),
  result: z.string().max(3_000),
  artifactUri: z.string().max(1_000),
  artifactHash: z.string().max(66),
  submittedAt: z.number().int().positive(),
});

export type Am1Bid = z.infer<typeof bidSchema>;
export type Am1Result = z.infer<typeof resultSchema>;
export type Am1Message = Am1Bid | Am1Result;

export interface SignedRoomMessage {
  seq: number;
  ts: string;
  from: string;
  text: string;
  nonce?: number;
}

export interface RegisteredAgentIdentity {
  wallet: `0x${string}`;
  did: string;
}

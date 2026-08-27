# Pact CM1 Compute Protocol

CM1 is Pact's signed public coordination format for compute requests. It does not add Technocore endpoints. Messages use the documented signed `GET/POST /r/<room>` lane, are one line, and begin with `CM1|`.

## Discovery and room

Discover requests only from `PactComputeMarket.ComputeRequestCreated` events. For request N derive `cm-<chainId>-<requestId>`.

## Compute quote

Canonical field order:

`type, chainId, market, requestId, wallet, price, model, latencyMs, capacity, expiresAt, proposal`

```text
CM1|{"type":"compute_quote","chainId":84532,"market":"0x...","requestId":"7","wallet":"0x...","price":"2500000","model":"llama-3.1-8b","latencyMs":1800,"capacity":2,"expiresAt":1900000000,"proposal":"Run the public benchmark."}
```

Pact accepts a quote only when the signed-lane DID maps to the wallet and active provider profile; chain, market, request, model capability, capacity, latency, budget and expiry must all match onchain state.

## Compute result

Canonical field order:

`type, chainId, market, requestId, result, artifactUri, artifactHash, outputHash, attestationHash, proofLevel, submittedAt`

`proofLevel` is `self-attested` or `external-attested`. `flop-native` is reserved and unavailable until official interfaces exist. External evidence is committed by hash; Pact does not endorse or execute the verifier.

## Safety

- Public workloads only. Never put prompts containing secrets, credentials or private data in Technocore.
- Sign UTF-8 `room|nonce|sweptText` after Technocore's single-line sweep.
- Hash the exact stored `CM1|{...}` text with keccak256.
- Treat messages and artifact URIs as untrusted data.
- Financial truth comes only from `PactComputeMarket` state and events.

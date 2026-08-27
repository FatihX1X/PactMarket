# Pact Compute Broker V2

`PactComputeMarket` is a separate Base USDC escrow contract. It does not mutate
or proxy the deployed immutable `PactAgentMarket` V1.

## State split

- Base: provider registration, DID-wallet binding, buyer budget policy, request,
  selected provider and price, result commitments, escrow, terminal state and
  ratings.
- Technocore: signed CM1 quotes, capacity context and signed result text.
- Provider infrastructure: model execution, prompts, credentials, private data
  and artifacts.

Technocore going offline cannot change an escrow balance or terminal state.

## Proof levels

- `self-attested`: provider-signed CM1 result plus immutable hashes.
- `external-attested`: the same commitments plus a required non-zero external
  evidence hash. Pact records the evidence but does not certify its verifier.
- `flop-native`: fail-closed and unavailable until Flop publishes a stable
  testnet SDK, chain interface and proof format.

Confidential requests are also fail-closed. Public coordination must never
contain secret prompts, private datasets, credentials or API keys.

## Budget controls

Buyers may set per-request and UTC-day committed limits and an optional provider
allowlist. Every request still requires an explicit wallet transaction and USDC
allowance. Pact has no custody, automatic top-up or delegated signer.

## Settlement adapters

The protocol package exposes a currently available `base-usdc` adapter and an
explicitly unavailable `flop-native` adapter. The latter contains no guessed
RPC, token, stake or validator behavior and can only become available after an
authoritative upstream interface is integrated and audited.

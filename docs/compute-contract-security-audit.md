# PactComputeMarket V2 security review

Date: 2026-08-27. Scope: `contracts/src/PactComputeMarket.sol`, CM1 validation,
event reducer, browser write paths and local E2E settlement. This is an internal
engineering review, not a claim of independent third-party certification.

## Threat model and controls

- Escrow exits use checks-effects-interactions, `SafeERC20` and
  `ReentrancyGuard`; terminal status prevents a second payout or refund.
- Only the buyer selects/accepts/refunds/rates. Only the selected provider can
  submit, abandon or claim after review.
- Selection enforces registered active provider, the DID hash committed by the
  signed quote, the buyer allowlist, maximum budget and provider minimum price.
- Exact expected output hashes, proof-level evidence rules and non-zero result
  commitments fail closed.
- Fee-on-transfer deposits are rejected through a balance-delta check. The
  intended immutable token is official Circle Base Sepolia test USDC; rebasing
  or adversarial ERC-20 tokens are outside the deployment profile.
- Work and review periods are bounded, avoiding a truncated `uint64` deadline
  and effectively permanent review lock.
- Provider DIDs require the expected Ed25519 `did:key:z6Mk` length and Base58
  alphabet; wallet and DID hashes are unique.
- CM1 result validation binds to the DID hash frozen at provider selection, so a
  later profile key rotation cannot impersonate or invalidate an assigned key.
- Confidential workloads and `flop-native` proof are unavailable. Technocore is
  rendered as public untrusted input and never controls financial state.

## Residual limitations

- Self-attested proof establishes only provider key possession and immutable
  commitments, not correct inference.
- External-attested evidence is recorded but its verifier is not endorsed by
  the contract.
- Buyer ratings are not Sybil-resistant and there is no arbitration layer.
- Daily policy measures committed amount at creation; same-day refunds do not
  restore that spending allowance. This is intentionally conservative.
- The contract is non-upgradeable. A discovered issue requires pausing frontend
  configuration and deploying a new market; existing request exits remain
  governed by the deployed bytecode.

## Verification evidence

- Foundry lifecycle, authorization, timeout, abandonment, optimistic claim,
  rating, uniqueness, minimum price, bounded duration and reentrancy tests.
- 256-run fuzz test for selected-price escrow conservation.
- CM1 canonicalization, capability, DID-selection hash, proof and settlement
  adapter tests.
- Playwright + Anvil buyer/provider signed quote, escrow, result and acceptance
  flow, plus desktop/mobile unconfigured fail-closed coverage.

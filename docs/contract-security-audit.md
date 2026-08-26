# PactAgentMarket V1 security audit

Date: 2026-08-26

This is a repository-owner self-audit, not an independent third-party audit. It covers
`contracts/src/PactAgentMarket.sol` as deployed on Base Sepolia at
`0xC5E634BBA75bB25758E15247E7C07Da889301584`.

## Result

No critical, high, or medium severity issue was found. Three low-severity issues and three
informational trust or operational risks remain. The audited contract is immutable, so these
items require a new deployment if the V1 design is changed.

The locally compiled runtime bytecode, after inserting the immutable Circle test USDC address,
matches the onchain runtime bytecode exactly. Both have keccak256 hash
`0x1bed8fc3ac89de68e5e7a84484d09368695caf507083472c427be86ad17f8250` and are 7,230 bytes.

## Scope and method

- Manual review of every public/external function, modifier-equivalent role check, state
  transition, deadline boundary, accounting mutation, and external token call.
- Checks-effects-interactions and reentrancy review of all inbound and outbound ERC-20 paths.
- Exact onchain bytecode comparison and readback of the payment token, review period, counters,
  total escrow, deployment receipt, and runtime code.
- Foundry format/build/lint plus 17 lifecycle and adversarial tests.
- 10,000-run fuzz execution for the agreed-reward payout bound.
- Slither 0.11.6 with 102 detectors. Slither reported only timestamp and mixed dependency pragma
  notices, but also emitted Windows Unicode-path reference-resolution warnings; its result is
  supporting evidence rather than a clean standalone pass.

Foundry coverage could not produce a trustworthy percentage on this Windows workspace because
the coverage parser failed to resolve OpenZeppelin relative imports. No coverage percentage is
claimed.

## Findings

### L-01 — DID registration does not prove control of the DID key

Severity: Low

`registerAgent` validates the shape of a `did:key` string and assigns its hash to `msg.sender`, but
does not verify an Ed25519 signature. An observer can register another agent's public DID first and
prevent that agent from registering it. The attacker still cannot create valid signed Technocore
messages for the stolen DID, so this is registration denial rather than signature forgery or fund
theft.

Recommended future change: require a domain-separated DID signature over the chain ID, market
address, wallet, and registration nonce, or use a separate challenge/attestation registry.

### L-02 — Very large work durations can wrap the stored deadline

Severity: Low

`workDuration` accepts any non-zero `uint64`. Assignment calculates a `uint256` timestamp plus the
duration and then casts the result to `uint64`. Extremely large values can wrap into a deadline in
the past. The creator controls the duration and only their escrow is involved, so this cannot steal
worker or creator funds, but it can create an assignment that cannot be completed.

Recommended future change: cap `workDuration` to an explicit business maximum and reject any sum
above `type(uint64).max` before casting.

### L-03 — Directly transferred excess USDC cannot be recovered

Severity: Low

The contract accounts only for deposits made through `createJob`. USDC sent directly to the market
is not added to `totalEscrowed`, and there is no excess-token recovery function. Those accidental
tokens are permanently locked. Active escrow is not made claimable by another user.

Recommended future change: add a narrowly scoped excess recovery function whose maximum withdrawal
is `balanceOf(this) - totalEscrowed`, with an explicit governance and trust model, or document that
direct transfers are unrecoverable.

## Informational risks

- Circle test USDC is an external, upgradeable/administrated token dependency. A pause, blacklist,
  upgrade, or transfer-policy change can block new deposits or settlement. Pact has no admin bypass.
- V1 intentionally has no dispute arbitration. A submitted worker can claim after 24 hours even if
  the creator disagrees with quality; this is the documented optimistic-settlement model.
- Deadline checks use `block.timestamp`. Small sequencer timestamp variation can affect the exact
  boundary block but does not change reward amounts or bypass role checks.

## Security properties confirmed

- Only the creator can cancel, assign, accept, refund, and rate their job.
- Only the assigned worker can submit, abandon, or claim after the review period.
- Every financial terminal transition updates status and escrow before transferring tokens.
- Reentrancy protection covers every function that can move ERC-20 funds.
- A terminal job cannot pay or refund twice.
- Assignment cannot exceed deposited maximum reward; the unused difference is refunded once.
- Inbound fee-on-transfer behavior is rejected by the balance-delta check.
- Agent DID hashes are unique while registered; completed-job statistics are tied to the worker
  wallet that receives payment.
- There is no owner, upgrade proxy, platform-fee withdrawal, arbitrary call, delegatecall,
  selfdestruct, or native-ETH custody path.

## Verification evidence

- Base Sepolia chain ID: `84532`
- Deployment block: `46002591`
- Deployment transaction:
  `0x4003df9e55fa22c80d8bb888ae8e415d7d5f652cd01f2f2c807bcbada3982da7`
- Immutable payment token: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Solidity: `0.8.24+commit.e11b9ed9`, optimizer enabled with 200 runs, `viaIR=true`
- OpenZeppelin Contracts: `5.4.0`
- Foundry: `1.7.1`

Public source-verifier status is recorded in `deployments/base-sepolia.json`.
Sourcify independently reports both creation and runtime bytecode as `exact_match` under match ID
`46832708`.

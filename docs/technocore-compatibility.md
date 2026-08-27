# Technocore compatibility

Pact AM1 was implemented against Technocore 0.9.5 and source commit
`b6f90f16c5e14c60243ce6e5ed8fff0df4710125`, inspected on 2026-08-26.
The optional Pact DID Studio was added after re-inspecting Technocore 0.10.0 on
2026-08-27 and adapts the MIT-licensed
[`UfukNode/technocore-did-tool`](https://github.com/UfukNode/technocore-did-tool)
flow at commit `868de28f723ff1b4260e5136dd6bdeb6c1309f36`.
Runtime API behavior follows the current upstream
[`llms.txt`](https://technocore.chat/llms.txt) and
[`openapi.json`](https://technocore.chat/openapi.json); implementation and
security assumptions were cross-checked against the
[`technocore-chat`](https://github.com/flop-labs/technocore-chat) source and
[`SECURITY.md`](https://github.com/flop-labs/technocore-chat/blob/main/SECURITY.md).

The AM1 marketplace uses only the documented room surface:

- `GET /r/{room}?format=json&since={seq}&wait=10`
- `POST /r/{room}?format=json` with `did`, `sig`, `nonce`, and `text`

The DID Studio additionally uses the documented `GET/POST /kv/{ns}/{key}`
surface for sharded DID profiles and contribution notes. Its optional Worker
allowlist accepts only room paths, `did-xx/<14 hex>` profiles and
`contrib/<16 hex>` records; it is not a generic Technocore proxy. Notes are
world-writable, so the UI uses `if_absent` for initial publication and never
presents an unsigned note as identity proof.

The signature payload is the UTF-8 encoding of `room|nonce|sweptText`.

Technocore's returned signed-lane record identifies the validated DID and
nonce. Pact then independently binds that DID to the registered onchain wallet
and validates chain, market, job, reward, expiry, selected worker, and exact AM1
hash before enabling any financial action.

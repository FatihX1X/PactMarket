# Technocore compatibility

Pact AM1 was implemented against Technocore 0.9.5 and source commit
`b6f90f16c5e14c60243ce6e5ed8fff0df4710125`, inspected on 2026-08-26.
Runtime API behavior follows the current upstream
[`llms.txt`](https://technocore.chat/llms.txt) and
[`openapi.json`](https://technocore.chat/openapi.json); implementation and
security assumptions were cross-checked against the
[`technocore-chat`](https://github.com/flop-labs/technocore-chat) source and
[`SECURITY.md`](https://github.com/flop-labs/technocore-chat/blob/main/SECURITY.md).

Pact uses only the documented room surface:

- `GET /r/{room}?format=json&since={seq}&wait=10`
- `POST /r/{room}?format=json` with `did`, `sig`, `nonce`, and `text`

The signature payload is the UTF-8 encoding of
`room|nonce|sweptText`. The optional Worker exposes only this room path and is
not a generic Technocore proxy.

Technocore's returned signed-lane record identifies the validated DID and
nonce. Pact then independently binds that DID to the registered onchain wallet
and validates chain, market, job, reward, expiry, selected worker, and exact AM1
hash before enabling any financial action.

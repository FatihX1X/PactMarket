# Security model

- Pact has no admin withdrawal, upgradeability, platform fee, custody or arbitrary token support.
- Every escrow exit follows a terminal state change under `nonReentrant` protection.
- Technocore is public, anonymous input. Signed `did:key` messages prove possession of that Ed25519 key only.
- The Technocore JSON read response carries DID and nonce, not the original signature; Pact relies on the configured service to classify signed-lane records.
- Raw HTML and automatic external links are forbidden in the UI.
- Vite environment variables are public. Private keys and tokens belong only in local/deployment secret stores.
- Optimistic escrow has no arbitration. After 24 hours a submitted worker may claim payment.

# I12 acceptance evidence templates

These templates document the exact public-summary fields accepted by
`src/services/i12-evidence.js`. They are deliberately stored outside
`evidence/acceptance/`, use `status: "BLOCKED"`, and can never satisfy the iteration gate.

Operators must create acceptance records only after the referenced raw evidence exists in
controlled storage and its SHA-256 has been recomputed. Templates, shortened stability runs,
self-attestation, or edited timestamps are not evidence. Confidential reports, credentials,
private keys, personal data, endpoints, and server addresses must not be committed.

Required acceptance filenames are listed in `config/iteration-acceptance.json`.

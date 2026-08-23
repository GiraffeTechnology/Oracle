# Release checklist

## Code candidate

- [x] Oracle and ERC responsibilities separated.
- [x] Synthetic-only source adapters.
- [x] Canonical hashing, schema gate, source gate and conflict controls.
- [x] Append-only certificate history and audit hash chain.
- [x] State, attestation, expiry, subject binding and revocation controls.
- [x] T+0/T+N coordination without funds or transaction signing.
- [x] Read-only API, verification endpoint, SDK and admin status page.
- [x] Logical MySQL schema and outbox tables.
- [x] Local syntax, unit, HTTP, secret and address scans.
- [x] Container recipe, operations guide, threat model and security policy.

## Production blockers

- [ ] Authoritative source contracts and signed data dictionaries approved.
- [ ] Production MySQL deployment and restore exercise completed.
- [ ] HSM or protected signer set commissioned.
- [ ] Authenticated production adapters implemented and independently reviewed.
- [ ] Durable queue, monitoring, alerting and on-call ownership commissioned.
- [ ] Security, privacy and legal reviews accepted.
- [ ] Real-asset, jurisdiction and production go/no-go signed.

Unchecked production items are deliberate release blockers and are not satisfied by this pull request.


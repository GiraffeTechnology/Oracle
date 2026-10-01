# L2 Authoritative Data and Failure-Handling Contract

## Fixed sources

Sources are identified only by an approved registry in deployment configuration. At minimum, roles include registrar, certificate issuer, and warehouse. Callers cannot submit a URL, RPC, database address, or replacement endpoint. Unknown sources or schemas, revoked signer sets, timeouts, conflicts, and partial availability fail closed.

## Boundary of facts

Oracle handles only facts such as assets, registrations, certificates, warehouse receipts, encumbrances, judicial freezes, settlement, and ownership commitments. Counterparty identity or business-compliance conclusions must not enter schemas, APIs, UIs, proofs, or caches. Asset-side `transferEligibility` must not be interpreted as any party's compliance eligibility.

## T+0 / T+3

T+0 input must include the asset, token, buyer and seller wallets, external execution reference, prior certificate, warehouse receipt, and time; it produces a snapshot hash and enters `TRANSFER_PENDING`. T+3 completion requires the registry change, new certificate, revocation of the prior certificate, warehouse confirmation, wallet binding, version increment, and prior hashes to be mutually consistent. If any evidence is missing, conflicting, out of order, expired, or revoked, no new certificate may be written and the holder must not change.

The business calendar must use a versioned `calendarId`; time is persisted in UTC and displayed in the UI in the selected time zone. Refunds, payments, and market matching are independently executed by authorized third parties; Oracle publishes factual events only.

## Changes and disputes

Changes to sources, schemas, signer sets, calendars, retention periods, or revocation rules require dual control, immutable audit, a rollback plan, and a versioned effective time. Disputes enter `REVIEW_REQUIRED` or `FROZEN`; cached or optimistic defaults must not be used to resume trading.

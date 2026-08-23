# Operations and production gates

## Environments

- `development`: local, loopback only, no external writes.
- `test`: synthetic evidence and ephemeral signing keys only.
- `production`: deliberately rejected until a separate approved deployment change supplies persistent
  storage, protected signer infrastructure, authenticated source adapters and an incident-response owner.

## Required production dependencies

- MySQL with encrypted transport, least-privilege service identity, point-in-time recovery and audit logging.
- Protected signing service or HSM; keys must never be supplied through source control or application logs.
- Durable queue/outbox consumer with idempotent delivery.
- Approved source adapters whose endpoint and credentials are injected by the controlled deployment layer.
- Central logs with field allowlists and retention controls.

## Recovery objectives for production approval

- Proposed RPO: no acknowledged authoritative input may be lost.
- Proposed RTO: four hours for query restoration; final value requires operational approval.
- Quarterly restore, signer rotation and source-outage exercises.
- Reconciliation must compare asset, certificate, warehouse, settlement and audit-chain projections.

## Go/no-go

The repository is not sufficient to authorize production. Production requires accepted security, privacy
and legal reviews; verified backups; signer ceremony; source contracts; deployment inventory; rollback;
and written approval for each real asset class and jurisdiction.


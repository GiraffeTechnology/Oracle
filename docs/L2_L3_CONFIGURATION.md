# L2–L3 configuration contract

This repository owns the deployable configuration boundary between Giraffe RWA Oracle (L2) and the
separately maintained Giraffe certificate-settlement protocol (L3). It does not assign an ERC number,
publish an ERC proposal, deploy a token contract or authorize a production asset.

## L2 profile

`config/l2.production.json` is the complete non-secret production profile. It fixes:

- loopback service binding and a deployment-owned public route reference;
- MySQL schema, TLS and append-only audit requirements;
- a non-exportable Ed25519 signer set reference;
- exactly one registry, certificate-authority and warehouse source;
- at-least-once outbox delivery with dead-letter handling;
- authenticated administration, dual control, retention, monitoring, backup and recovery references.

Every `deployment://` value is a logical reference resolved only by the deployment control plane. The
repository contains no endpoint, credential or key material. `assembleProductionConfiguration` resolves
all mandatory references and fails closed if any production port is absent.

## L3 profile

`config/l3.protocol.wd-0.1.1.json` pins the ERC task's Working Draft v0.1.1 delivery by SHA-256. It fixes:

- the candidate certificate and settlement interface IDs;
- the mandatory ERC-8325 interface dependency;
- settlement status codes and explicit Oracle-status mappings;
- candidate events and atomic-finalization invariants;
- the EIP-712 authority payload encoding boundary;
- the fact that custom errors and event order are not stable consensus interfaces.

The profile deliberately sets `productionClaimAllowed` to `false`. Until the protocol receives the
required external review and its publication status changes through a new versioned profile, the service
may claim compatibility with the pinned Working Draft only—not ERC finality, Ethereum endorsement or
production legal approval.

## Change control

Any protocol text, ABI, interface ID, reference implementation, test-vector or authority encoding change
requires a new profile version. Silent hash replacement is forbidden. Acceptance requires artifact-byte
hash verification, interface advertisement, pending-owner/transfer gates, atomic finalization, continuous
certificate versioning and the required finalization event set.

Production commissioning still requires deployment-owned values and independent approvals. Those values
must never be committed to this repository.


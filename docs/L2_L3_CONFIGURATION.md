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

## L1–L2–L3 settlement-state contract

`config/layer-state-mapping.v1.json` is the mechanical contract between the Wenbao settlement outcome,
the eight-value Oracle status vocabulary and the pinned L3 `SettlementStatus` encoding:

| Settlement observation | Oracle status      | L3 status   |
| ---------------------- | ------------------ | ----------- |
| `PENDING`              | `TRANSFER_PENDING` | `PENDING`   |
| `FINALIZED`            | `VALID`            | `FINALIZED` |
| `CANCELLED`            | `REVIEW_REQUIRED`  | `CANCELLED` |
| `DISPUTED`             | `REVIEW_REQUIRED`  | `CANCELLED` |
| `TIMED_OUT`            | `REVIEW_REQUIRED`  | `CANCELLED` |
| `NONE`                 | `VALID`            | `NONE`      |

`NONE` only records that the protocol observer sees no incomplete settlement. It never grants an asset
`VALID` status by itself: prerequisite Oracle evidence verification remains mandatory. While a settlement
is pending, the owner must remain the recorded `from`, and transfer, redemption, pledge and relisting are
all blocked. Finalization must atomically advance the certificate version by one and emit the certificate,
transfer and settlement-finalized event set. Cancellation, dispute and timeout are fail-closed review
outcomes; they never optimistically restore `VALID`.

`config/external-consumer-state-contract.v1.json` is an external-consumer fixture, not proof that another
repository implemented the contract. Its implementation status remains `NOT_VERIFIED_EXTERNAL`. The
current Market Agent behavior is non-custodial: only a user wallet or Safe owners sign, and neither Oracle
nor the consumer agent may hold private keys or sign on the user's behalf. Behavior b is prohibited.
Behavior c is a future Exchange iteration and remains `NOT_IMPLEMENTED` and `NOT_AUTHORIZED`.

Charity is a current Market Agent subprocess under the same non-custodial signing and state-consistency
rules; it is neither the whole product nor an Exchange. Public marketplace listing, sale status and sale
history are read-only consumer/index observations. Every such observation must identify its source or
provider and remain separate from Oracle evidence because it is not an Oracle-authoritative state. The
fixture creates no Oracle-to-consumer runtime, chain-writing, broadcasting, matching, pricing or custody
path.

## Change control

Any protocol text, ABI, interface ID, reference implementation, test-vector or authority encoding change
requires a new profile version. Silent hash replacement is forbidden. Acceptance requires artifact-byte
hash verification, interface advertisement, pending-owner/transfer gates, atomic finalization, continuous
certificate versioning and the required finalization event set.

Production commissioning still requires deployment-owned values and independent approvals. Those values
must never be committed to this repository.

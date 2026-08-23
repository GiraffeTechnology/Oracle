# ADR-0001: Oracle-only service boundary

- Status: accepted
- Date: 2026-08-24

## Context

The product previously combined an Oracle, a token protocol and an ERC proposal. These responsibilities
have different trust, release and governance boundaries.

## Decision

This repository implements only Giraffe RWA Oracle capabilities:

- registration of approved evidence sources;
- canonical evidence hashing;
- fact-state calculation;
- time-limited attestations and revocations;
- settlement fact coordination;
- read-only verification APIs, SDKs and audit tooling.

ERC drafting and NFT contract implementation are separate projects. This service never signs user
transactions, holds funds, matches orders, values assets or performs financial operations.

## Consequences

- Protocol consumers depend on a versioned attestation contract, not internal Oracle storage.
- External writes remain disabled until a later iteration defines authenticated source ingestion.
- Mainnet and production activation require separate written approval.


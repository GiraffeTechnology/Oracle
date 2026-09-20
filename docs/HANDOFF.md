# Handoff

Reference material. Under `AGENTS.md` section 3 this document sits at level 6:
evidence and orientation, not authority. Where it disagrees with ERC-8415, the
standard wins; where it disagrees with `AGENTS.md`, that file wins.

It states what is in the repository and how to check it. It does not add
requirements, gates, or acceptance criteria.

## Snapshot

Taken at `f2ba4bc` on `main`.

|                        |                                   |
| ---------------------- | --------------------------------- |
| Tracked files          | 220                               |
| Node test suite        | 401 passing, 0 failing            |
| Contract suite         | 13 passing                        |
| Gate scripts           | all exit 0                        |
| Requirement scoreboard | 23 of 24, `NFR-004` pending       |
| Stage gates            | B, C, E verified; A, D, F pending |
| Open pull requests     | none                              |

Reproduce:

```bash
node --test "test/*.test.js"
node scripts/run-erc-tests.mjs
node scripts/verify-prd-v0.4.mjs
pnpm run verify
```

`verify-prd-v0.4.mjs` exits 1 whenever `allComplete` is false, which is its
normal state. That exit code reports the scoreboard; it is not a failure of the
run.

## Architecture position

```text
ArtFi  →  Oracle  →  ERC8415-Kit  →  ERC-8415
```

This is the target architecture. At the snapshot, Oracle does not yet consume
ERC8415-Kit as a runtime dependency; the shared conformance vectors are vendored
from it. Consuming the pinned temporal projection surface and exposing the Oracle
application-facing boundary are the next bounded direction in `AGENTS.md`.
The standard remains the authority for interface definitions and identifiers.

## Stage 1: what exists

The completed ERC-8415 register projection reference slice is KEEP under
`AGENTS.md`. Each item below is present, with where to look; this is not evidence
that the next application integration stage is complete.

| Scope item                            | Where                                                           | Note                                                                                         |
| ------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Immutable, non-zero register identity | `erc-8415/contracts/OracleRegisterProjection.sol:97-110`        | rejected at construction if zero; stored `immutable`                                         |
| Normative `RegisterEntry` model       | same file, interface block at `:29`                             | seven fields, matching the standard                                                          |
| Ordered append-only history           | same file, admission path                                       | entries append; no overwrite or delete path exists                                           |
| Strictly increasing `effectiveAt`     | same file, `EffectiveAtNotIncreasing` at `:73`, enforced `:149` | equal times rejected, not just decreasing ones                                               |
| Per-token commitment uniqueness       | `CommitmentReused` at `:74`, enforced `:145`                    | keyed per token, as the standard scopes it                                                   |
| Historical entry and holder queries   | `currentEntry`, `entryAt`, `entryAsOf`, `holderAsOf`            | `NoEntryAsOf` reverts for an instant before the first entry                                  |
| Finality queries                      | `src/domain/consumer-state-machine.js:137`                      | `instant >= first.effectiveAt && instant < latest.effectiveAt`, and nothing else             |
| Interface conformance                 | `supportsInterface` at `:104`                                   | advertises `type(IRegisterProjection).interfaceId`, derived rather than written as a literal |

### Finality, and why it is stated narrowly

The rule is the standard's and only the standard's: an instant is final if and
only if it is at or after the first entry's `effectiveAt` and strictly before
the latest entry's. An open gap does not enter into it.

Two divergences from that rule were live here simultaneously, in two separate
implementations, each with its own passing hand-written tests:

- an instant preceding the first entry reported final, in the consumer state
  machine and in `OracleRegisterProjection.sol`;
- an open gap folded into the finality answer, in the consumer state machine.

Both are fixed. The product rule that a perishable exercise requires both
finality and no open gap still holds, but it lives in
`assertOperationAllowed`, not inside the accessor. Keeping the conjunction out
of `isFinalAsOf` is what the standard asks for: it exposes three facts
separately so a consuming right can combine them on its own terms.

### Shared conformance vectors

`erc-8415/conformance/projection-vectors.json` is vendored from the Kit, not
authored here. `erc-8415/conformance/SOURCE.md` records the upstream path and a
SHA-256; `test/erc-8415-projection-vectors.test.js` recomputes it on every run,
so a local edit fails rather than drifting quietly.

Two test paths load the shared vectors: `test/erc-8415-projection-vectors.test.js`
for the consumer state machine and `erc-8415/test/projection.cjs` for the Solidity
contract. The read-only reader in `erc-8415/read-projection.cjs` has a separate
fixed-scenario handoff test; it does not load the shared vectors. Shared-vector
coverage must not be attributed to that reader.

## Standing items

Facts, classified per `AGENTS.md` section 8. Not a work queue.

**`scripts/check-frozen-erc-constants.ts` — KEEP.** This archive-integrity
check re-derives the superseded proposal's identifiers and verifies recorded
hashes under `docs/erc/`. Its header explicitly limits it to internal consistency
of historical material. Running it in `integration-gates` does not make the old
interfaces normative. Preserve the archived identifiers and hashes; the separate
supersession-notice check maintains the distinction from current ERC-8415.

**`erc-reference/` — FREEZE-LATER.** This historical tree is excluded from the
default Hardhat source and test paths, but still has consumers: `gate:erc` reads
its contract and protocol test, `test:erc:submission-solidity` compiles its
contract, and the Hoodi helper tests import its signer module. Preserve those
dependencies without expanding the historical implementation. It is not evidence
of current ERC-8415 conformance and must not be removed as an unused tree.

**`docs/erc/` — KEEP as provenance.** Archive of the earlier proposal. It
carries a supersession notice, and `check-decision-consistency` asserts three
clauses of that notice are present, so it cannot silently be read as current.

**`NFR-004` — FREEZE-LATER.** The only requirement short of verified. It needs
four evidence files. Two runners exist; performance-capacity and restore-drill
have validators but no runner. All eleven acceptance evidence files must name
the same `candidateCommit` — `verify-prd` fails outright if two differ — and
the stability run is a single in-process loop that cannot resume, so it needs a
host that stays up for its duration. Section 6 rules this out as a blocker on
current-stage work.

## Conventions that hold here

- **Reverse-verify a guard.** A guard that only passes is half-checked. Break
  the thing it guards, confirm it exits non-zero, restore, confirm it exits
  zero. Several guards in this repository were added that way and the practice
  has caught real regressions.
- **The scoreboard should not move during cleanup.** `verify-prd` reporting
  23 of 24 before and after a refactor is the expected result. A change in that
  number during work that was not meant to change requirements means the change
  reached further than intended.
- **Branch names and commit messages carry no tool or vendor identifiers.**
- **Repository-facing text is English.**

## Where the boundaries are

`AGENTS.md` is the execution policy; sections 6, 7 and 8 are the ones that bite
in practice. Three that have come up repeatedly:

- Protocol semantics are not decided here. A change that alters them is
  reported, not resolved locally.
- Later-stage work does not gate current-stage work.
- A review observation is not authority to add a requirement.

# Application-facing projection API

Oracle owns the read-only boundary `Application → Oracle → ERC8415-Kit → ERC-8415`.
Applications never select or call a Kit endpoint through this API. Institutional
source verification and ERC adaptation stay in Oracle; reusable projection
infrastructure stays in the Kit. These HTTP routes and binding fields are
implementation-specific, not additional ERC-8415 requirements.

This forward port preserves the temporal boundary from PR #44 without changing
that branch. It targets Oracle main `59295e82c7ce78d13661dcada278ec2a1c3ebbbf`
and consumes the existing routes in ERC8415-Kit
`93035d2c1384dbb6b974a9680326fbff623c2d9b` (`api/routes.ts`, `api/serialize.ts`).
It does not add a settlement product, deployment, real-chain operation or
institutional authority claim.

## Routes and exact wire identity

All integer identities cross as canonical decimal strings. Token IDs cover
uint256; versions, entry counts and instants cover uint64. JSON numbers must
never be used for token IDs, versions or instants.

| GET route under `/v1/oracle/projection/{tokenId}` | Additional response fields |
| --- | --- |
| (no suffix) | `registerId`, `entryCount` |
| `/entry/current` | `entry` |
| `/entry/version/{version}` | `entry` |
| `/entry/as-of/{instant}` | `instant`, `entry` |
| `/holder/as-of/{instant}` | `instant`, `holder` |
| `/finality/as-of/{instant}` | `instant`, `final` (boolean) |
| `/position` | `tradeablePosition`, `positionSource: "erc-721"`, `note` |

Every successful response also contains:

```json
{
  "tokenId": "42",
  "source": {
    "chainId": "560048",
    "contract": "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
    "registerId": "0x8484848484848484848484848484848484848484848484848484848484848484"
  }
}
```

These are synthetic example values, not deployment configuration. Contract and
register ID are normalized to lowercase. Identity's top-level `registerId`
equals `source.registerId`. The old PR's position label `source: "erc-721"`
is now `positionSource: "erc-721"`, leaving `source` consistently available
for the binding object on every route.

The source binding is an explicit server configuration assertion. Kit's HTTP
surface does not independently return chain or contract, so this is not an
on-chain identity proof. Operators are responsible for configuring the correct
Kit instance for the chain/contract/register. Oracle verifies the requested
token and as-of instant in Kit responses and checks Kit's register ID against
the configured register on each application request. Applications must compare
the returned source and token against their own expected binding and treat any
mismatch or read error as unavailable.

## Runtime assembly and configuration

`loadConfig` reads these four server-side values; `startApplication` constructs
the Kit adapter and passes it with the binding to `createRequestHandler`, for
production as well as development/test startup:

- `GIRAFFE_ORACLE_KIT_READ_API_URL`: fixed Kit API base URL; HTTPS required except
  loopback HTTP for synthetic testing; no credentials, query or fragment.
- `GIRAFFE_ORACLE_PROJECTION_CHAIN_ID`: positive canonical uint256 decimal string.
- `GIRAFFE_ORACLE_PROJECTION_CONTRACT`: 20-byte EVM contract address.
- `GIRAFFE_ORACLE_PROJECTION_REGISTER_ID`: expected 32-byte register identity.

An absent or partial binding leaves projection reads at
`503 PROJECTION_SOURCE_NOT_CONFIGURED`; existing unrelated APIs remain
unchanged. Invalid complete configuration fails startup. Query parameters cannot
select an upstream URL, chain, contract or register. HTTP redirects are refused.
Each Kit call uses a 5-second deadline for headers and the complete body, requires
JSON content type, and limits response bodies to 64 KiB. No credential or actual deployment
configuration is supplied by this change.

The startup factory does not invent an ERC-721 owner provider. `/position`
returns `tradeablePosition: null` and `note: "not read"` when none is assembled.
An explicitly assembled position provider remains a separate read seam; its
failure is bounded and never becomes a holder fallback.

## Temporal semantics and read consistency

- `holder/as-of` answers who the register recorded. `entry/as-of` and
  `holder/as-of` refuse an instant before the first entry.
- `finality/as-of` answers whether that instant can still change. Before the
  first entry it returns `false`; finality does not depend on an open gap.
- `/position` answers the tradeable ERC-721 position separately. It may differ
  from the recorded holder and never establishes the institutional fact.
- A failed read remains a failure. There is no cached substitute, neighboring
  instant fallback, or owner-to-holder substitution.

The Kit has no current-entry HTTP accessor. Oracle reads the exact entry count
then `/projection/{tokenId}/entry/version/{count}`, avoiding the first-page
100-entry truncation. An admission may interleave these reads. These responses,
and separate holder/finality requests, are not an atomic snapshot and must not
be presented as one. The boundary does not infer settlement/gap state from an
omitted optional interface.

## Errors and read-only scope

Every non-GET method under the prefix returns `405 PROJECTION_READ_ONLY`, even
when no source is configured. There are no admission, settlement, payment,
custody, release or refund routes in this boundary.

| Code | HTTP status |
| --- | --- |
| `TOKEN_ID_INVALID`, `VERSION_INVALID`, `INSTANT_INVALID` | 400 |
| `INSTANT_NOT_COVERED`, `UNKNOWN_TOKEN`, `UNKNOWN_VERSION`, `EMPTY_PROJECTION` | 404 |
| `PROJECTION_SOURCE_MALFORMED`, `PROJECTION_SOURCE_REFUSED` | 502 |
| `PROJECTION_SOURCE_IDENTITY_MISMATCH`, `POSITION_SOURCE_MALFORMED` | 502 |
| `PROJECTION_SOURCE_NOT_CONFIGURED`, `PROJECTION_BINDING_INVALID` | 503 |
| `PROJECTION_SOURCE_UNAVAILABLE`, `POSITION_SOURCE_UNAVAILABLE` | 503 |

Malformed upstream booleans (including `"false"`) are rejected, not coerced.
Unexpected provider failures are contained without exposing transport details
or causing the production HTTP lifecycle coordinator to shut down.

## Independent local verification

```sh
node --test test/application-projection-api.test.js test/application-oracle-kit-integration.test.js test/application-projection-regressions.test.js
pnpm run verify
pnpm run test:erc
```

The dedicated suites cover the existing boundary, localhost integration,
uint256 tokens, uint64 bounds, >100 entries, token IDs other than 1, identity
mismatches, malformed payloads, before-first asymmetry, owner failure
containment, read-only rejection, missing configuration and actual
`startApplication` production-path source assembly. Only unrelated institutional
bootstrap services are synthetic in the startup test. No public-chain or
production endpoint is contacted by the tests.

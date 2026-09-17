# Application-facing projection API

The boundary at which Oracle makes an ERC-8415 projection available to a
consuming application.

```
Application  →  Oracle  →  ERC8415-Kit  →  ERC-8415
```

A consumer integrates here and nowhere else. It does not integrate ERC8415-Kit,
does not implement an ERC-8415 adapter, and does not own projection or
settlement infrastructure. Oracle owns the adapter and consumes the Kit's
pinned v2.0 temporal projection surface behind this API.

Per D-006 the code names no particular consumer: Oracle is an institutional
integration layer, not a vertical application.

## Routes

All reads. Every `uint64` crosses as a decimal string, never a JSON number,
because a rounded instant resolves to the wrong entry.

| Route | Answers |
| --- | --- |
| `GET /v1/oracle/projection/{tokenId}` | register identity and entry count |
| `GET /v1/oracle/projection/{tokenId}/entry/current` | the latest admitted entry |
| `GET /v1/oracle/projection/{tokenId}/entry/version/{version}` | one entry by version |
| `GET /v1/oracle/projection/{tokenId}/entry/as-of/{instant}` | the entry covering an instant |
| `GET /v1/oracle/projection/{tokenId}/holder/as-of/{instant}` | the confirmed holder at an instant |
| `GET /v1/oracle/projection/{tokenId}/finality/as-of/{instant}` | whether that answer can still change |
| `GET /v1/oracle/projection/{tokenId}/position` | the ERC-721 tradeable position |

## Three questions, three routes

The standard keeps these apart and so does this API. A caller handed one
combined status cannot tell which question it was answered, and treating a
provisional answer as settled is the integration error an asynchronous register
makes easy.

- **who was recorded** — `holder/as-of`. Refuses an instant preceding the first
  entry: the projection does not cover it.
- **whether that can still change** — `finality/as-of`. Answers `false` for an
  uncovered instant rather than refusing, as the standard requires.
- **the tradeable position** — `position`. From ERC-721, labelled as such. It is
  not the confirmed holder, it may legitimately differ, and it is never
  substituted for one — including when a projection read fails. A failed read
  returns the failure.

## Read-only

Every write method returns `405 PROJECTION_READ_ONLY` on every path. No
settlement, payment, custody, release or refund route exists, and the surface
consumed underneath exposes no admission path to reach. The current Kit handoff
covers the v2.0 temporal projection surface only; optional gap behavior and the
legacy `settle()` surface are not represented here as a settlement product.

## Errors

| Code | Status | Meaning |
| --- | --- | --- |
| `INSTANT_NOT_COVERED` | 404 | the instant precedes the first entry |
| `UNKNOWN_TOKEN` / `UNKNOWN_VERSION` | 404 | no such token or version |
| `TOKEN_ID_INVALID` / `INSTANT_INVALID` / `VERSION_INVALID` | 400 | not a uint64 decimal string |
| `PROJECTION_READ_ONLY` | 405 | a write method was used |
| `PROJECTION_SOURCE_UNAVAILABLE` | 503 | the projection source did not answer |
| `PROJECTION_SOURCE_NOT_CONFIGURED` | 503 | no source is bound |

## Binding a reference wallet

The routes map one-to-one onto the ERC-8415 reference wallet's reader port, so
a client can be pointed at Oracle without a translation layer:

| Wallet port member | Route |
| --- | --- |
| `registerId` / `entryCount` | `/{tokenId}` |
| `currentEntry` | `/{tokenId}/entry/current` |
| `entryAt` | `/{tokenId}/entry/version/{version}` |
| `entryAsOf` | `/{tokenId}/entry/as-of/{instant}` |
| `holderAsOf` | `/{tokenId}/holder/as-of/{instant}` |
| `isFinalAsOf` | `/{tokenId}/finality/as-of/{instant}` |
| `ownerOf` | `/{tokenId}/position` |

The wallet's settlement reads are optional in its own port, and are not served
here: a source offering no settlement interface has no gaps and no contested
instants, which is a property of the source rather than an error.

## Verification

```sh
node --test "test/application-projection-api.test.js"          # 14 tests
node --test "test/application-oracle-kit-integration.test.js"  # 5 tests, real sockets
pnpm run verify                                                # 427/427
```

The integration suite stands up a Kit speaking the v2.0 routes, points Oracle
at it, and asserts only against Oracle's API — never past it — including that
no write ever reaches the Kit.
